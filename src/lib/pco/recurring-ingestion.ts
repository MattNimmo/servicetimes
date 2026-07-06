import "server-only";

import { buildCampusPlan } from "@/lib/pco/build-campus-plan";
import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import {
  fetchPlanBundleIfCompleted,
  listPastPlansSince,
  type BundleFetchResult,
} from "@/lib/pco/fetch-plan";
import {
  buildIngestionPlan,
  type IngestionPlan,
  type PcoCampus,
} from "@/lib/pco/ingestion-plan";
import { persistIngestionPlan } from "@/lib/pco/ingestion-writer";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";
import { readRows } from "@/lib/supabase/rest";

type Dependencies = {
  buildCampusPlan: typeof buildCampusPlan;
  persistPlan: typeof persistIngestionPlan;
};

const defaultDependencies: Dependencies = {
  buildCampusPlan,
  persistPlan: persistIngestionPlan,
};

const SLOT_BLOCKING_KINDS = [
  "slot_resolution",
  "missing_live_bounds",
  "zero_live_window",
  "reconciliation_gap",
] as const;

type PlanFreshness =
  | { status: "missing" }
  | { status: "complete"; planId: number }
  | { status: "incomplete"; planId: number; reasons: string[] };

type RepairDependencies = {
  listPastPlans: typeof listPastPlansSince;
  fetchPlanBundle: typeof fetchPlanBundleIfCompleted;
  getPlanFreshness: typeof getPlanFreshness;
  buildIngestionPlan: typeof buildIngestionPlan;
  persistPlan: typeof persistIngestionPlan;
  now: () => Date;
};

const defaultRepairDependencies: RepairDependencies = {
  listPastPlans: listPastPlansSince,
  fetchPlanBundle: fetchPlanBundleIfCompleted,
  getPlanFreshness,
  buildIngestionPlan,
  persistPlan: persistIngestionPlan,
  now: () => new Date(),
};

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "Unknown ingestion error";
}

export async function runRecurringPcoIngestion(
  dependencies: Dependencies = defaultDependencies,
) {
  const previews = await Promise.allSettled(
    PCO_CAMPUSES.map(dependencies.buildCampusPlan),
  );

  if (previews.some(({ status }) => status === "rejected")) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      writesPerformed: 0,
      campuses: previews.map((result, index) =>
        result.status === "fulfilled"
          ? {
              campus: PCO_CAMPUSES[index].code,
              pcoPlanId: result.value.plan.pcoPlanId,
              status: "previewed" as const,
            }
          : {
              campus: PCO_CAMPUSES[index].code,
              status: "preview_failed" as const,
              error: errorMessage(result.reason),
            },
      ),
    };
  }

  const plans = previews.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const writes = await Promise.allSettled(plans.map(dependencies.persistPlan));

  return {
    ok: writes.every(({ status }) => status === "fulfilled"),
    generatedAt: new Date().toISOString(),
    writesPerformed: writes.filter(({ status }) => status === "fulfilled").length,
    campuses: writes.map((result, index) =>
      result.status === "fulfilled"
        ? {
            campus: PCO_CAMPUSES[index].code,
            pcoPlanId: plans[index].plan.pcoPlanId,
            status: "committed" as const,
            result: result.value,
          }
        : {
            campus: PCO_CAMPUSES[index].code,
            pcoPlanId: plans[index].plan.pcoPlanId,
            status: "write_failed" as const,
            error: errorMessage(result.reason),
          },
    ),
  };
}

function sinceIso(weeks: number, now: Date) {
  if (!Number.isSafeInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new Error("weeks must be an integer between 1 and 52");
  }
  return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

export async function getPlanFreshness(
  campus: PcoCampus,
  pcoPlanId: string,
): Promise<PlanFreshness> {
  const plans = await readRows<{ id: number; campus_id: number }>("plans", {
    pco_plan_id: `eq.${pcoPlanId}`,
    select: "id,campus_id",
    limit: "1",
  });
  const plan = plans[0];
  if (!plan) return { status: "missing" };

  const planTimes = await readRows<{
    id: number;
    effective_slot_id: number | null;
    live_starts_at: string | null;
    live_ends_at: string | null;
  }>("effective_plan_times", {
    plan_id: `eq.${plan.id}`,
    time_type: "eq.service",
    is_manually_excluded: "eq.false",
    effective_slot_id: "not.is.null",
    select: "id,effective_slot_id,live_starts_at,live_ends_at",
  });

  const reasons: string[] = [];
  const effectiveSlotCount = new Set(planTimes.map((pt) => pt.effective_slot_id)).size;
  if (effectiveSlotCount < campus.slots.length) {
    reasons.push(
      `expected ${campus.slots.length} production slots, found ${effectiveSlotCount}`,
    );
  }
  if (planTimes.some((pt) => !pt.live_starts_at || !pt.live_ends_at)) {
    reasons.push("production slot is missing LIVE bounds");
  }

  const planTimeIds = planTimes.map(({ id }) => id);
  const [elementRows, planIncidents, planTimeIncidents] = await Promise.all([
    readRows<{ plan_time_id: number; actual_is_complete: boolean }>("element_variance", {
      plan_id: `eq.${plan.id}`,
      select: "plan_time_id,actual_is_complete",
    }),
    readRows<{ id: number }>("review_incidents", {
      plan_id: `eq.${plan.id}`,
      status: "eq.open",
      kind: `in.(${SLOT_BLOCKING_KINDS.join(",")})`,
      select: "id",
    }),
    planTimeIds.length > 0
      ? readRows<{ id: number }>("review_incidents", {
          plan_time_id: `in.(${planTimeIds.join(",")})`,
          status: "eq.open",
          kind: `in.(${SLOT_BLOCKING_KINDS.join(",")})`,
          select: "id",
        })
      : Promise.resolve([]),
  ]);

  const elementRowsByPlanTime = new Map<number, typeof elementRows>();
  for (const row of elementRows) {
    const rows = elementRowsByPlanTime.get(row.plan_time_id) ?? [];
    rows.push(row);
    elementRowsByPlanTime.set(row.plan_time_id, rows);
  }
  for (const planTime of planTimes) {
    const rows = elementRowsByPlanTime.get(planTime.id) ?? [];
    if (rows.length === 0 || rows.some((row) => !row.actual_is_complete)) {
      reasons.push(`plan_time ${planTime.id} has incomplete item actuals`);
    }
  }
  if (planIncidents.length + planTimeIncidents.length > 0) {
    reasons.push("open slot-blocking incidents remain");
  }

  return reasons.length > 0
    ? { status: "incomplete", planId: plan.id, reasons }
    : { status: "complete", planId: plan.id };
}

function committedCampusResult(
  campus: PcoCampus,
  plan: IngestionPlan,
  result: Awaited<ReturnType<typeof persistIngestionPlan>>,
) {
  return {
    campus: campus.code,
    pcoPlanId: plan.plan.pcoPlanId,
    status: "committed" as const,
    result,
  };
}

function skippedResult(
  campus: PcoCampus,
  pcoPlanId: string,
  status: "skipped_complete" | "skipped_unqualified",
  reason: string,
) {
  return {
    campus: campus.code,
    pcoPlanId,
    status,
    reason,
  };
}

function writeFailedResult(
  campus: PcoCampus,
  pcoPlanId: string,
  reason: unknown,
) {
  return {
    campus: campus.code,
    pcoPlanId,
    status: "write_failed" as const,
    error: errorMessage(reason),
  };
}

export async function runRepairPcoIngestion(
  options: { weeks?: number } = {},
  dependencies: RepairDependencies = defaultRepairDependencies,
) {
  const weeks = options.weeks ?? 3;
  const since = sinceIso(weeks, dependencies.now());
  const campuses: Array<
    | ReturnType<typeof committedCampusResult>
    | ReturnType<typeof skippedResult>
    | ReturnType<typeof writeFailedResult>
  > = [];

  for (const campus of PCO_CAMPUSES) {
    let plans;
    try {
      plans = await dependencies.listPastPlans(campus.serviceTypeId, since);
    } catch (error) {
      campuses.push(writeFailedResult(campus, "unknown", error));
      continue;
    }

    for (const plan of plans) {
      let freshness: PlanFreshness;
      try {
        freshness = await dependencies.getPlanFreshness(campus, plan.id);
      } catch (error) {
        campuses.push(writeFailedResult(campus, plan.id, error));
        continue;
      }

      if (freshness.status === "complete") {
        campuses.push(
          skippedResult(campus, plan.id, "skipped_complete", "plan is already complete"),
        );
        continue;
      }

      let bundleResult: BundleFetchResult;
      try {
        bundleResult = await dependencies.fetchPlanBundle(campus.serviceTypeId, plan);
      } catch (error) {
        campuses.push(writeFailedResult(campus, plan.id, error));
        continue;
      }
      if (bundleResult.status === "skipped") {
        campuses.push(
          skippedResult(campus, plan.id, "skipped_unqualified", bundleResult.reason),
        );
        continue;
      }

      const ingestionPlan = dependencies.buildIngestionPlan(
        campus,
        bundleResult.bundle,
        PCO_TAXONOMY,
      );
      try {
        const persisted = await dependencies.persistPlan(ingestionPlan);
        campuses.push(committedCampusResult(campus, ingestionPlan, persisted));
      } catch (error) {
        campuses.push(writeFailedResult(campus, plan.id, error));
      }
    }
  }

  const writesPerformed = campuses.filter(({ status }) => status === "committed").length;
  const ok = campuses.every(({ status }) => status !== "write_failed");
  return {
    ok,
    generatedAt: new Date().toISOString(),
    writesPerformed,
    campuses,
  };
}

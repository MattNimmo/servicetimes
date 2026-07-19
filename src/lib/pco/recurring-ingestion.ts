import "server-only";

import { randomUUID } from "node:crypto";

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
import { mostRecentChicagoSunday } from "@/lib/pco/ingest-health";
import { persistIngestionPlan } from "@/lib/pco/ingestion-writer";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";
import { readRows } from "@/lib/supabase/rest";

type Dependencies = {
  buildCampusPlan: typeof buildCampusPlan;
  persistPlan: typeof persistIngestionPlan;
  getCampusDateFreshness: typeof getCampusDateFreshness;
  countPersistedCampuses: typeof countPersistedCampuses;
  now: () => Date;
};

const defaultDependencies: Dependencies = {
  buildCampusPlan,
  persistPlan: persistIngestionPlan,
  getCampusDateFreshness,
  countPersistedCampuses,
  now: () => new Date(),
};

const SLOT_BLOCKING_KINDS = [
  "slot_resolution",
  "missing_live_bounds",
  "zero_live_window",
  "reconciliation_gap",
] as const;

export type PlanFreshness =
  | { status: "missing" }
  | { status: "complete"; planId: number; pcoPlanId: string }
  | {
      status: "incomplete";
      planId: number;
      pcoPlanId: string;
      reasons: string[];
    };

export type CampusDateFreshness = PlanFreshness;

type RecurringCampusResult =
  | {
      campus: PcoCampus["code"];
      pcoPlanId: string;
      planId: number;
      status: "skipped_complete";
    }
  | {
      campus: PcoCampus["code"];
      pcoPlanId?: string;
      planId?: number;
      status: "preview_failed";
      error: string;
    }
  | {
      campus: PcoCampus["code"];
      pcoPlanId: string;
      planId?: number;
      status: "write_failed";
      error: string;
    }
  | {
      campus: PcoCampus["code"];
      pcoPlanId: string;
      planId?: number;
      status: "committed";
      result: Awaited<ReturnType<typeof persistIngestionPlan>>;
    };

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
  const message = reason instanceof Error ? reason.message : "Unknown ingestion error";
  return message
    .replace(/(bearer|basic)\s+\S+/gi, "$1 [REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

function logRecurringCampusResult(
  invocationId: string,
  expectedServiceDate: string,
  stage: "freshness" | "preview" | "date_validation" | "write",
  result: RecurringCampusResult,
  startedAt: number,
) {
  console.info(
    "[pco-recurring-campus]",
    JSON.stringify({
      invocationId,
      campus: result.campus,
      stage,
      status: result.status,
      expectedServiceDate,
      ...(result.pcoPlanId ? { pcoPlanId: result.pcoPlanId } : {}),
      ...(result.planId ? { planId: result.planId } : {}),
      ...(result.status === "preview_failed" || result.status === "write_failed"
        ? { error: result.error }
        : {}),
      durationMs: Date.now() - startedAt,
    }),
  );
  return result;
}

async function runRecurringCampusIngestion(
  campus: PcoCampus,
  expectedServiceDate: string,
  dependencies: Dependencies,
  invocationId: string,
): Promise<RecurringCampusResult> {
  const startedAt = Date.now();
  let freshness: CampusDateFreshness;

  try {
    freshness = await dependencies.getCampusDateFreshness(
      campus,
      expectedServiceDate,
    );
  } catch (error) {
    return logRecurringCampusResult(
      invocationId,
      expectedServiceDate,
      "freshness",
      {
        campus: campus.code,
        status: "preview_failed",
        error: errorMessage(error),
      },
      startedAt,
    );
  }

  if (freshness.status === "complete") {
    return logRecurringCampusResult(
      invocationId,
      expectedServiceDate,
      "freshness",
      {
        campus: campus.code,
        pcoPlanId: freshness.pcoPlanId,
        planId: freshness.planId,
        status: "skipped_complete",
      },
      startedAt,
    );
  }

  let preview: IngestionPlan;
  try {
    preview = await dependencies.buildCampusPlan(campus, expectedServiceDate);
  } catch (error) {
    return logRecurringCampusResult(
      invocationId,
      expectedServiceDate,
      "preview",
      {
        campus: campus.code,
        ...(freshness.status === "incomplete"
          ? { pcoPlanId: freshness.pcoPlanId, planId: freshness.planId }
          : {}),
        status: "preview_failed",
        error: errorMessage(error),
      },
      startedAt,
    );
  }

  if (preview.plan.serviceDate !== expectedServiceDate) {
    return logRecurringCampusResult(
      invocationId,
      expectedServiceDate,
      "date_validation",
      {
        campus: campus.code,
        pcoPlanId: preview.plan.pcoPlanId,
        ...(freshness.status === "incomplete" ? { planId: freshness.planId } : {}),
        status: "preview_failed",
        error: `Expected ${expectedServiceDate}, received ${preview.plan.serviceDate}`,
      },
      startedAt,
    );
  }

  try {
    const result = await dependencies.persistPlan(preview);
    return logRecurringCampusResult(
      invocationId,
      expectedServiceDate,
      "write",
      {
        campus: campus.code,
        pcoPlanId: preview.plan.pcoPlanId,
        ...(freshness.status === "incomplete" ? { planId: freshness.planId } : {}),
        status: "committed",
        result,
      },
      startedAt,
    );
  } catch (error) {
    return logRecurringCampusResult(
      invocationId,
      expectedServiceDate,
      "write",
      {
        campus: campus.code,
        pcoPlanId: preview.plan.pcoPlanId,
        ...(freshness.status === "incomplete" ? { planId: freshness.planId } : {}),
        status: "write_failed",
        error: errorMessage(error),
      },
      startedAt,
    );
  }
}

export async function runRecurringPcoIngestion(
  dependencyOverrides: Partial<Dependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const invocationId = randomUUID();
  const expectedServiceDate = mostRecentChicagoSunday(dependencies.now());
  const startedAt = Date.now();
  const campusSettlements = await Promise.allSettled(
    PCO_CAMPUSES.map((campus) =>
      runRecurringCampusIngestion(
        campus,
        expectedServiceDate,
        dependencies,
        invocationId,
      ),
    ),
  );
  const campuses = campusSettlements.map((settlement, index) =>
    settlement.status === "fulfilled"
      ? settlement.value
      : logRecurringCampusResult(
          invocationId,
          expectedServiceDate,
          "preview",
          {
            campus: PCO_CAMPUSES[index].code,
            status: "preview_failed",
            error: errorMessage(settlement.reason),
          },
          startedAt,
        ),
  );
  const successfulLocations = await dependencies.countPersistedCampuses(
    expectedServiceDate,
  );
  const writesPerformed = campuses.filter(
    ({ status }) => status === "committed",
  ).length;
  const counts = {
    committed: writesPerformed,
    skippedComplete: campuses.filter(
      ({ status }) => status === "skipped_complete",
    ).length,
    previewFailed: campuses.filter(({ status }) => status === "preview_failed")
      .length,
    writeFailed: campuses.filter(({ status }) => status === "write_failed").length,
  };

  console.info(
    "[pco-recurring-summary]",
    JSON.stringify({
      invocationId,
      expectedServiceDate,
      ...counts,
      successfulLocations,
      expectedLocations: PCO_CAMPUSES.length,
    }),
  );

  return {
    ok: successfulLocations === PCO_CAMPUSES.length,
    generatedAt: new Date().toISOString(),
    expectedServiceDate,
    writesPerformed,
    verification: {
      successfulLocations,
      expectedLocations: PCO_CAMPUSES.length,
    },
    campuses,
  };
}

async function countPersistedCampuses(serviceDate: string) {
  const plans = await readRows<{ campus_id: number }>("plans", {
    service_date: `eq.${serviceDate}`,
    select: "campus_id",
  });
  return new Set(plans.map(({ campus_id }) => campus_id)).size;
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
  const plans = await readRows<{ id: number; pco_plan_id: string }>("plans", {
    pco_plan_id: `eq.${pcoPlanId}`,
    select: "id,pco_plan_id",
    limit: "1",
  });
  const plan = plans[0];
  if (!plan) return { status: "missing" };

  return evaluatePersistedPlanFreshness(campus, plan);
}

export async function getCampusDateFreshness(
  campus: PcoCampus,
  serviceDate: string,
): Promise<CampusDateFreshness> {
  const campuses = await readRows<{ id: number }>("campuses", {
    code: `eq.${campus.code}`,
    select: "id",
    limit: "1",
  });
  const campusId = campuses[0]?.id;
  if (!campusId) {
    throw new Error(`Campus ${campus.code} is not configured`);
  }

  const plans = await readRows<{ id: number; pco_plan_id: string }>("plans", {
    campus_id: `eq.${campusId}`,
    service_date: `eq.${serviceDate}`,
    select: "id,pco_plan_id",
    order: "sort_date.desc",
  });
  if (plans.length === 0) return { status: "missing" };

  const incomplete: Array<Extract<PlanFreshness, { status: "incomplete" }>> = [];
  for (const plan of plans) {
    const freshness = await evaluatePersistedPlanFreshness(campus, plan);
    if (freshness.status === "complete") return freshness;
    if (freshness.status === "incomplete") incomplete.push(freshness);
  }

  return incomplete[0] ?? { status: "missing" };
}

async function evaluatePersistedPlanFreshness(
  campus: PcoCampus,
  plan: { id: number; pco_plan_id: string },
): Promise<Exclude<PlanFreshness, { status: "missing" }>> {
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
    ? {
        status: "incomplete",
        planId: plan.id,
        pcoPlanId: plan.pco_plan_id,
        reasons,
      }
    : { status: "complete", planId: plan.id, pcoPlanId: plan.pco_plan_id };
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

import "server-only";

import { normalizeNextPath, pcoGet, pcoGetAll } from "@/lib/pco/client";
import { isNonProductionName } from "@/lib/pco/non-production";
import type { PlanBundle } from "@/lib/pco/ingestion-plan";
import type {
  PcoCollection,
  PcoItem,
  PcoItemTime,
  PcoPlan,
  PcoPlanTime,
} from "@/lib/pco/types";

function durationSeconds(start: string | null, end: string | null) {
  if (!start || !end) return null;

  const duration = (Date.parse(end) - Date.parse(start)) / 1_000;
  return Number.isFinite(duration) ? duration : null;
}

async function fetchCompletedPlanBundle(
  serviceTypeId: string,
  plan: PcoPlan,
  knownPlanTimes?: PcoCollection<PcoPlanTime>,
): Promise<PlanBundle | null> {
  const planTimes =
    knownPlanTimes ??
    (await pcoGetAll<PcoPlanTime>(
      `/services/v2/service_types/${serviceTypeId}/plans/${plan.id}/plan_times?per_page=100`,
    ));
  const hasCompletedService = planTimes.data.some(({ attributes }) => {
    return (
      attributes.time_type === "service" &&
      !isNonProductionName(attributes.name) &&
      attributes.recorded &&
      durationSeconds(attributes.live_starts_at, attributes.live_ends_at) !== null
    );
  });

  if (!hasCompletedService) return null;

  const items = await pcoGetAll<PcoItem, PcoItemTime>(
    `/services/v2/service_types/${serviceTypeId}/plans/${plan.id}/items?include=item_times&per_page=100`,
  );

  return {
    plan,
    planTimes: planTimes.data,
    items: items.data,
    itemTimes: (items.included ?? []).filter(
      (resource): resource is PcoItemTime => resource.type === "ItemTime",
    ),
  };
}

export async function fetchLatestCompletedPlan(
  serviceTypeId: string,
  expectedServiceDate?: string,
) {
  const [pastPlans, futurePlans] = await Promise.all([
    pcoGet<PcoCollection<PcoPlan>>(
      `/services/v2/service_types/${serviceTypeId}/plans?filter=past&order=-sort_date&per_page=5`,
    ),
    pcoGet<PcoCollection<PcoPlan>>(
      `/services/v2/service_types/${serviceTypeId}/plans?filter=future&order=sort_date&per_page=5`,
    ),
  ]);

  const now = Date.now();
  const planById = new Map<string, PcoPlan>();
  for (const plan of [...pastPlans.data, ...futurePlans.data]) {
    const sortTime = Date.parse(plan.attributes.sort_date);
    if (!Number.isFinite(sortTime) || sortTime > now) continue;
    planById.set(plan.id, plan);
  }

  const candidates = [...planById.values()]
    .filter(
      (plan) =>
        !expectedServiceDate ||
        plan.attributes.sort_date.slice(0, 10) === expectedServiceDate,
    )
    .sort(
      (left, right) =>
        Date.parse(right.attributes.sort_date) - Date.parse(left.attributes.sort_date),
    );

  for (const plan of candidates) {
    const bundle = await fetchCompletedPlanBundle(serviceTypeId, plan);
    if (bundle) return bundle;
  }

  throw new Error(
    expectedServiceDate
      ? `No completed production service was found for ${expectedServiceDate}`
      : `No completed service was found in the latest ${candidates.length} arrived plans`,
  );
}

// ── Historical backfill support ──────────────────────────────────────────────

/**
 * List past plans newest-first, stopping as soon as a plan's sort_date falls
 * before `sinceIso`. Unlike pcoGetAll, this intentionally stops paging early
 * so a 12-month backfill doesn't walk the campus's entire multi-year history.
 */
export async function listPastPlansSince(
  serviceTypeId: string,
  sinceIso: string,
): Promise<PcoPlan[]> {
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) {
    throw new Error(`Invalid since date: ${sinceIso}`);
  }

  const collected: PcoPlan[] = [];
  let next: string | null =
    `/services/v2/service_types/${serviceTypeId}/plans?filter=past&order=-sort_date&per_page=25`;
  let pages = 0;

  while (next) {
    if (pages >= 40) {
      throw new Error("Backfill plan listing exceeded the 40-page safety limit");
    }
    const page: PcoCollection<PcoPlan> = await pcoGet(next);
    for (const plan of page.data) {
      if (Date.parse(plan.attributes.sort_date) < sinceMs) {
        return collected;
      }
      collected.push(plan);
    }
    next = page.links?.next ? normalizeNextPath(page.links.next) : null;
    pages += 1;
  }

  return collected;
}

export type BundleFetchResult =
  | { status: "ok"; bundle: PlanBundle }
  | { status: "skipped"; reason: string };

/**
 * Fetch the full bundle for one plan, applying the same completed-production
 * gate as fetchLatestCompletedPlan — but returning a skip reason instead of
 * throwing, so the backfill census can account for every week.
 */
export async function fetchPlanBundleIfCompleted(
  serviceTypeId: string,
  plan: PcoPlan,
): Promise<BundleFetchResult> {
  const planTimes = await pcoGetAll<PcoPlanTime>(
    `/services/v2/service_types/${serviceTypeId}/plans/${plan.id}/plan_times?per_page=100`,
  );

  const production = planTimes.data.filter(
    ({ attributes }) =>
      attributes.time_type === "service" && !isNonProductionName(attributes.name),
  );
  if (production.length === 0) {
    return { status: "skipped", reason: "no production service plan_time" };
  }
  const hasCompletedService = production.some(
    ({ attributes }) =>
      attributes.recorded &&
      durationSeconds(attributes.live_starts_at, attributes.live_ends_at) !== null,
  );
  if (!hasCompletedService) {
    return {
      status: "skipped",
      reason: "no recorded LIVE bounds on any production plan_time",
    };
  }

  return {
    status: "ok",
    bundle: (await fetchCompletedPlanBundle(serviceTypeId, plan, planTimes))!,
  };
}

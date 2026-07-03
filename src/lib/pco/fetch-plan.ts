import "server-only";

import { normalizeNextPath, pcoGet, pcoGetAll } from "@/lib/pco/client";
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

// Mirrors the patterns in supabase/migrations/20260625213000_expand_non_production_name_rules.sql.
// A plan_time whose name matches any of these is not a production service, even if time_type=service.
const NON_PRODUCTION_NAME_PATTERNS = [
  "rehearsal",
  "run through",
  "run-through",
  "walk through",
  "walk-through",
  "tech team",
  "tech-team",
  "translation",
  "instrumentalists",
  "vocalists",
  "broadcast audio",
];

function isNonProductionName(name: string | null): boolean {
  const lower = (name ?? "").toLowerCase();
  return NON_PRODUCTION_NAME_PATTERNS.some((p) => lower.includes(p));
}

export async function fetchLatestCompletedPlan(serviceTypeId: string) {
  const plans = await pcoGet<PcoCollection<PcoPlan>>(
    `/services/v2/service_types/${serviceTypeId}/plans?filter=past&order=-sort_date&per_page=10`,
  );

  for (const plan of plans.data) {
    const planTimes = await pcoGetAll<PcoPlanTime>(
      `/services/v2/service_types/${serviceTypeId}/plans/${plan.id}/plan_times?per_page=100`,
    );
    const hasCompletedService = planTimes.data.some(({ attributes }) => {
      return (
        attributes.time_type === "service" &&
        !isNonProductionName(attributes.name) &&
        attributes.recorded &&
        durationSeconds(attributes.live_starts_at, attributes.live_ends_at) !==
          null
      );
    });

    if (!hasCompletedService) continue;

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

  throw new Error(
    `No completed service was found in the latest ${plans.data.length} plans`,
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

  const items = await pcoGetAll<PcoItem, PcoItemTime>(
    `/services/v2/service_types/${serviceTypeId}/plans/${plan.id}/items?include=item_times&per_page=100`,
  );

  return {
    status: "ok",
    bundle: {
      plan,
      planTimes: planTimes.data,
      items: items.data,
      itemTimes: (items.included ?? []).filter(
        (resource): resource is PcoItemTime => resource.type === "ItemTime",
      ),
    },
  };
}

import "server-only";

import { pcoGet, pcoGetAll } from "@/lib/pco/client";
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

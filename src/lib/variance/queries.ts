import "server-only";

import { readRows } from "@/lib/supabase/rest";

export type VarianceStatus = "complete" | "needs_review" | "no_plan";

export type VarianceValue = {
  status: VarianceStatus;
  plannedSeconds: number | null;
  actualSeconds: number | null;
  deltaSeconds: number | null;
  deltaPercent: number | null;
};

export type Campus = {
  id: number;
  code: string;
  name: string;
};

export type ReviewIncident = {
  id: number;
  plan_id: number | null;
  plan_time_id: number | null;
  slot_id: number | null;
  kind: string;
  review_incident_items: Array<{ item_id: number | string }>;
};

type Plan = {
  id: number;
  campus_id: number;
  service_date: string;
  title: string | null;
  series_title: string | null;
  sort_date: string;
};

type EffectivePlanTime = {
  id: number;
  effective_slot_id: number;
  planned_target_seconds: number | null;
  actual_service_seconds: number | null;
  slot_resolution_state: "auto" | "review";
};

type ActivePlanTimeCorrection = {
  plan_time_id: number;
  corrected_actual_seconds: number | null;
};

type ServiceSlot = {
  id: number;
  slot_label: string;
  expected_local_start: string;
};

type ElementVarianceRow = {
  plan_id: number;
  plan_time_id: number;
  effective_slot_id: number;
  slot_label: string;
  element_key: string;
  section_key: string;
  section_name: string;
  section_sort_order: number;
  element_name: string;
  element_sort_order: number;
  item_ids: Array<number | string>;
  planned_seconds: number;
  actual_seconds: number | null;
  actual_is_complete: boolean;
};

const SLOT_BLOCKING_KINDS = new Set([
  "missing_live_bounds",
  "zero_live_window",
  "reconciliation_gap",
  "slot_resolution",
]);

export function computeVariance(
  plannedSeconds: number | null,
  actualSeconds: number | null,
  needsReview = false,
): VarianceValue {
  if (plannedSeconds === null) {
    return {
      status: "no_plan",
      plannedSeconds,
      actualSeconds,
      deltaSeconds: null,
      deltaPercent: null,
    };
  }
  if (needsReview || actualSeconds === null) {
    return {
      status: "needs_review",
      plannedSeconds,
      actualSeconds,
      deltaSeconds: null,
      deltaPercent: null,
    };
  }

  const deltaSeconds = actualSeconds - plannedSeconds;
  return {
    status: "complete",
    plannedSeconds,
    actualSeconds,
    deltaSeconds,
    deltaPercent: plannedSeconds === 0 ? null : (deltaSeconds / plannedSeconds) * 100,
  };
}

function incidentCoversSlot(
  incident: ReviewIncident,
  planTimeId: number,
  slotId: number,
) {
  return incident.plan_time_id === planTimeId ||
    (incident.plan_time_id === null && incident.slot_id === slotId);
}

export function isSlotBlocked(
  incidents: ReviewIncident[],
  planTimeId: number,
  slotId: number,
) {
  return incidents.some(
    (incident) =>
      SLOT_BLOCKING_KINDS.has(incident.kind) &&
      incidentCoversSlot(incident, planTimeId, slotId),
  );
}

export function isElementBlocked(
  incidents: ReviewIncident[],
  planTimeId: number,
  slotId: number,
  itemIds: Array<number | string>,
) {
  if (isSlotBlocked(incidents, planTimeId, slotId)) return true;
  const itemIdSet = new Set(itemIds.map(String));
  return incidents.some(
    (incident) =>
      incidentCoversSlot(incident, planTimeId, slotId) &&
      incident.review_incident_items.some(({ item_id }) => itemIdSet.has(String(item_id))),
  );
}

export async function listCampuses() {
  return readRows<Campus>("campuses", {
    select: "id,code,name",
    order: "code.asc",
  });
}

async function campusByCode(code: string) {
  const rows = await readRows<Campus>("campuses", {
    code: `eq.${code.toUpperCase()}`,
    select: "id,code,name",
    limit: "1",
  });
  return rows[0] ?? null;
}

async function openIncidents(planId: number, planTimeIds: number[]) {
  const scope =
    planTimeIds.length === 0
      ? `(plan_id.eq.${planId})`
      : `(plan_id.eq.${planId},plan_time_id.in.(${planTimeIds.join(",")}))`;
  return readRows<ReviewIncident>("review_incidents", {
    status: "eq.open",
    or: scope,
    select: "id,plan_id,plan_time_id,slot_id,kind,review_incident_items(item_id)",
  });
}

async function allPlanTimeIds(planId: number) {
  return readRows<{ id: number }>("plan_times", {
    plan_id: `eq.${planId}`,
    select: "id",
  });
}

async function activePlanTimeCorrections(planTimeIds: number[]) {
  if (planTimeIds.length === 0) return [];
  return readRows<ActivePlanTimeCorrection>("active_plan_time_corrections", {
    plan_time_id: `in.(${planTimeIds.join(",")})`,
    select: "plan_time_id,corrected_actual_seconds",
  });
}

async function unmappedCount(campus: string, serviceDate: string) {
  const rows = await readRows<{ id: number }>("unmapped_items", {
    campus: `eq.${campus}`,
    service_date: `eq.${serviceDate}`,
    select: "id",
  });
  return rows.length;
}

export async function listServiceDates(code: string) {
  const campus = await campusByCode(code);
  if (!campus) return null;
  const plans = await readRows<Plan>("plans", {
    campus_id: `eq.${campus.id}`,
    select: "id,campus_id,service_date,title,series_title,sort_date",
    order: "service_date.desc,sort_date.desc",
  });

  const dates = await Promise.all(
    plans.map(async (plan) => {
      const [planTimes, everyPlanTime] = await Promise.all([
        readRows<{
          id: number;
          effective_slot_id: number;
          planned_target_seconds: number | null;
          actual_service_seconds: number | null;
        }>("effective_plan_times", {
          plan_id: `eq.${plan.id}`,
          effective_slot_id: "not.is.null",
          time_type: "eq.service",
          is_manually_excluded: "eq.false",
          select: "id,effective_slot_id,planned_target_seconds,actual_service_seconds",
        }),
        allPlanTimeIds(plan.id),
      ]);
      const [incidents, unmapped, corrections] = await Promise.all([
        openIncidents(plan.id, everyPlanTime.map(({ id }) => id)),
        unmappedCount(campus.code, plan.service_date),
        activePlanTimeCorrections(planTimes.map(({ id }) => id)),
      ]);
      const correctionByPlanTimeId = new Map(
        corrections.map((correction) => [correction.plan_time_id, correction]),
      );

      // Date-level verdict: the most-over service of the day, vs plan, using
      // the same correction/blocked rules as the detail dashboard.
      const completeDeltas = planTimes
        .map((planTime) =>
          computeVariance(
            planTime.planned_target_seconds,
            correctionByPlanTimeId.get(planTime.id)?.corrected_actual_seconds ??
              planTime.actual_service_seconds,
            isSlotBlocked(incidents, planTime.id, planTime.effective_slot_id),
          ),
        )
        .filter(
          (variance): variance is VarianceValue & { deltaSeconds: number } =>
            variance.status === "complete" && variance.deltaSeconds !== null,
        )
        .map(({ deltaSeconds }) => deltaSeconds);

      return {
        ...plan,
        slotCount: planTimes.length,
        openIncidentCount: incidents.length,
        unmappedCount: unmapped,
        worstDeltaSeconds:
          completeDeltas.length > 0 ? Math.max(...completeDeltas) : null,
      };
    }),
  );

  return { campus, dates };
}

export async function getVarianceDashboard(code: string, serviceDate: string) {
  const campus = await campusByCode(code);
  if (!campus) return null;
  const plans = await readRows<Plan>("plans", {
    campus_id: `eq.${campus.id}`,
    service_date: `eq.${serviceDate}`,
    select: "id,campus_id,service_date,title,series_title,sort_date",
    order: "sort_date.desc",
    limit: "1",
  });
  const plan = plans[0];
  if (!plan) return { campus, plan: null };

  const [planTimes, everyPlanTime, slots, elements, unmapped] = await Promise.all([
    readRows<EffectivePlanTime>("effective_plan_times", {
      plan_id: `eq.${plan.id}`,
      effective_slot_id: "not.is.null",
      time_type: "eq.service",
      is_manually_excluded: "eq.false",
      select:
        "id,effective_slot_id,planned_target_seconds,actual_service_seconds,slot_resolution_state",
    }),
    allPlanTimeIds(plan.id),
    readRows<ServiceSlot>("service_slots", {
      campus_id: `eq.${campus.id}`,
      is_active: "eq.true",
      select: "id,slot_label,expected_local_start",
      order: "expected_local_start.asc",
    }),
    readRows<ElementVarianceRow>("element_variance", {
      plan_id: `eq.${plan.id}`,
      select: "*",
      order: "section_sort_order.asc,element_sort_order.asc",
    }),
    unmappedCount(campus.code, plan.service_date),
  ]);
  const [incidents, corrections] = await Promise.all([
    openIncidents(plan.id, everyPlanTime.map(({ id }) => id)),
    activePlanTimeCorrections(planTimes.map(({ id }) => id)),
  ]);
  const correctionByPlanTimeId = new Map(
    corrections.map((correction) => [correction.plan_time_id, correction]),
  );

  return {
    campus,
    plan,
    openIncidentCount: incidents.length,
    unmappedCount: unmapped,
    slots: planTimes
      .map((planTime) => {
        const slot = slots.find(({ id }) => id === planTime.effective_slot_id);
        return {
          ...planTime,
          slotLabel: slot?.slot_label ?? "Unknown slot",
          expectedLocalStart: slot?.expected_local_start ?? null,
          variance: computeVariance(
            planTime.planned_target_seconds,
            correctionByPlanTimeId.get(planTime.id)?.corrected_actual_seconds ??
              planTime.actual_service_seconds,
            isSlotBlocked(incidents, planTime.id, planTime.effective_slot_id),
          ),
        };
      })
      .sort((left, right) =>
        (left.expectedLocalStart ?? "").localeCompare(right.expectedLocalStart ?? ""),
      ),
    elements: elements.map((element) => ({
      ...element,
      variance: computeVariance(
        element.planned_seconds,
        element.actual_seconds,
        !element.actual_is_complete ||
          isElementBlocked(
            incidents,
            element.plan_time_id,
            element.effective_slot_id,
            element.item_ids,
          ),
      ),
    })),
  };
}

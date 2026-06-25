import "server-only";

import { readRows } from "@/lib/supabase/rest";

type OpenIncidentRow = {
  id: number;
  plan_id: number | null;
  plan_time_id: number | null;
  slot_id: number | null;
  kind: string;
  detail: string;
  evidence: Record<string, unknown>;
  opened_at: string;
  review_incident_items: Array<{
    item_id: number | string;
    item_time_id: number | string | null;
  }>;
};

type PlanTimeRow = {
  id: number;
  plan_id: number;
  pco_name: string | null;
  starts_at: string | null;
  live_starts_at: string | null;
  planned_target_seconds: number | null;
  actual_service_seconds: number | null;
};

type PlanRow = {
  id: number;
  campus_id: number;
  service_date: string;
  title: string | null;
  series_title: string | null;
};

type CampusRow = {
  id: number;
  code: string;
  name: string;
};

type SlotRow = {
  id: number;
  campus_id: number;
  slot_label: string;
  expected_local_start: string;
  is_run_through: boolean;
  is_active: boolean;
};

type ItemRow = {
  id: number;
  plan_id: number;
  sequence: number;
  raw_title: string;
  item_type: "song" | "header" | "media" | "item";
  service_position: "pre" | "during" | "post" | null;
  section_key: string | null;
  element_key: string | null;
  planned_seconds: number | null;
};

type ItemTimeRow = {
  id: number;
  item_id: number;
  plan_time_id: number;
  actual_seconds: number | null;
};

export type OpenReviewIncident = {
  id: number;
  kind: string;
  detail: string;
  evidence: Record<string, unknown>;
  openedAt: string;
  campusCode: string;
  campusName: string;
  serviceDate: string;
  planTitle: string;
  planTimeName: string | null;
  planTimeStartsAt: string | null;
  planTimeLiveStartsAt: string | null;
  slotLabel: string | null;
  plannedTargetSeconds: number | null;
  actualServiceSeconds: number | null;
  canCorrectPlanTimeActual: boolean;
  canResolveSlotResolution: boolean;
  canCorrectItemTimes: boolean;
  availableSlots: Array<{
    id: number;
    label: string;
    expectedLocalStart: string;
  }>;
  itemCount: number;
  items: Array<{
    id: number;
    itemTimeId: number | null;
    title: string;
    sectionKey: string | null;
    elementKey: string | null;
    plannedSeconds: number | null;
    actualSeconds: number | null;
  }>;
  occurrenceItems: Array<{
    id: number;
    sequence: number;
    title: string;
    itemType: "song" | "header" | "media" | "item";
    servicePosition: "pre" | "during" | "post" | null;
    sectionKey: string | null;
    elementKey: string | null;
    plannedSeconds: number | null;
    actualSeconds: number | null;
  }>;
};

const PLAN_TIME_CORRECTION_KINDS = new Set([
  "missing_live_bounds",
  "zero_live_window",
  "reconciliation_gap",
]);

const SLOT_RESOLUTION_KINDS = new Set(["slot_resolution"]);
const ITEM_TIME_CORRECTION_KINDS = new Set([
  "missing_item_end",
  "bundle_overlap",
]);

function uniqueNumbers(values: Array<number | null | undefined>) {
  return Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      ),
    ),
  );
}

function inFilter(values: number[]) {
  return `in.(${values.join(",")})`;
}

async function readByIds<T>(table: string, ids: number[], select: string) {
  if (ids.length === 0) return [];
  return readRows<T>(table, {
    id: inFilter(ids),
    select,
  });
}

export async function listOpenReviewIncidents(): Promise<OpenReviewIncident[]> {
  const incidents = await readRows<OpenIncidentRow>("review_incidents", {
    status: "eq.open",
    select:
      "id,plan_id,plan_time_id,slot_id,kind,detail,evidence,opened_at,review_incident_items(item_id,item_time_id)",
    order: "opened_at.asc",
  });

  const planTimes = await readByIds<PlanTimeRow>(
    "plan_times",
    uniqueNumbers(incidents.map(({ plan_time_id }) => plan_time_id)),
    "id,plan_id,pco_name,starts_at,live_starts_at,planned_target_seconds,actual_service_seconds",
  );
  const planTimeById = new Map(planTimes.map((planTime) => [planTime.id, planTime]));

  const planIds = uniqueNumbers([
    ...incidents.map(({ plan_id }) => plan_id),
    ...planTimes.map(({ plan_id }) => plan_id),
  ]);
  const plans = await readByIds<PlanRow>(
    "plans",
    planIds,
    "id,campus_id,service_date,title,series_title",
  );
  const planById = new Map(plans.map((plan) => [plan.id, plan]));

  const campusIds = uniqueNumbers(plans.map(({ campus_id }) => campus_id));

  const planTimeIds = uniqueNumbers(incidents.map(({ plan_time_id }) => plan_time_id));

  const [campuses, slots, incidentItems, planItems, itemTimes] = await Promise.all([
    readByIds<CampusRow>(
      "campuses",
      campusIds,
      "id,code,name",
    ),
    campusIds.length === 0
      ? Promise.resolve([] as SlotRow[])
      : readRows<SlotRow>("service_slots", {
          campus_id: inFilter(campusIds),
          select: "id,campus_id,slot_label,expected_local_start,is_run_through,is_active",
        }),
    readByIds<ItemRow>(
      "items",
      uniqueNumbers(
        incidents.flatMap(({ review_incident_items }) =>
          review_incident_items.map(({ item_id }) => Number(item_id)),
        ),
      ),
      "id,plan_id,sequence,raw_title,item_type,service_position,section_key,element_key,planned_seconds",
    ),
    planIds.length === 0
      ? Promise.resolve([] as ItemRow[])
      : readRows<ItemRow>("items", {
          plan_id: inFilter(planIds),
          select:
            "id,plan_id,sequence,raw_title,item_type,service_position,section_key,element_key,planned_seconds",
          order: "sequence.asc",
        }),
    planTimeIds.length === 0
      ? Promise.resolve([] as ItemTimeRow[])
      : readRows<ItemTimeRow>("item_times", {
          plan_time_id: inFilter(planTimeIds),
          select: "id,item_id,plan_time_id,actual_seconds",
        }),
  ]);

  const campusById = new Map(campuses.map((campus) => [campus.id, campus]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const itemById = new Map(incidentItems.map((item) => [item.id, item]));
  const itemTimeById = new Map(itemTimes.map((itemTime) => [itemTime.id, itemTime]));
  const itemTimeByPlanTimeAndItemId = new Map<string, ItemTimeRow>();
  const slotsByCampusId = new Map<number, SlotRow[]>();
  const planItemsByPlanId = new Map<number, ItemRow[]>();
  for (const itemTime of itemTimes) {
    itemTimeByPlanTimeAndItemId.set(
      `${itemTime.plan_time_id}:${itemTime.item_id}`,
      itemTime,
    );
  }
  for (const slot of slots) {
    const campusSlots = slotsByCampusId.get(slot.campus_id) ?? [];
    campusSlots.push(slot);
    slotsByCampusId.set(slot.campus_id, campusSlots);
  }
  for (const item of planItems) {
    const itemsForPlan = planItemsByPlanId.get(item.plan_id) ?? [];
    itemsForPlan.push(item);
    planItemsByPlanId.set(item.plan_id, itemsForPlan);
  }

  return incidents
    .map((incident) => {
      const planTime =
        incident.plan_time_id === null ? null : planTimeById.get(incident.plan_time_id);
      const planId = incident.plan_id ?? planTime?.plan_id ?? null;
      const plan = planId === null ? undefined : planById.get(planId);
      const campus = plan ? campusById.get(plan.campus_id) : undefined;
      if (!plan || !campus) return null;

      const incidentItems = incident.review_incident_items
        .map(({ item_id, item_time_id }) => {
          const item = itemById.get(Number(item_id));
          if (!item) return null;
          const itemTime =
            item_time_id === null ? null : itemTimeById.get(Number(item_time_id)) ?? null;
          return { item, itemTime };
        })
        .filter(
          (
            item,
          ): item is {
            item: ItemRow;
            itemTime: ItemTimeRow | null;
          } => Boolean(item),
        );

      return {
        id: incident.id,
        kind: incident.kind,
        detail: incident.detail,
        evidence: incident.evidence,
        openedAt: incident.opened_at,
        campusCode: campus.code,
        campusName: campus.name,
        serviceDate: plan.service_date,
        planTitle: plan.title ?? plan.series_title ?? "Weekend service",
        planTimeName: planTime?.pco_name ?? null,
        planTimeStartsAt: planTime?.starts_at ?? null,
        planTimeLiveStartsAt: planTime?.live_starts_at ?? null,
        slotLabel:
          incident.slot_id === null
            ? null
            : (slotById.get(incident.slot_id)?.slot_label ?? null),
        plannedTargetSeconds: planTime?.planned_target_seconds ?? null,
        actualServiceSeconds: planTime?.actual_service_seconds ?? null,
        canCorrectPlanTimeActual:
          incident.plan_time_id !== null && PLAN_TIME_CORRECTION_KINDS.has(incident.kind),
        canResolveSlotResolution:
          incident.plan_time_id !== null && SLOT_RESOLUTION_KINDS.has(incident.kind),
        canCorrectItemTimes: ITEM_TIME_CORRECTION_KINDS.has(incident.kind),
        availableSlots: (slotsByCampusId.get(campus.id) ?? [])
          .filter((slot) => slot.is_active && !slot.is_run_through)
          .sort((left, right) => left.expected_local_start.localeCompare(right.expected_local_start))
          .map((slot) => ({
            id: slot.id,
            label: slot.slot_label,
            expectedLocalStart: slot.expected_local_start,
          })),
        itemCount: incident.review_incident_items.length,
        items: incidentItems.map(({ item, itemTime }) => ({
          id: item.id,
          itemTimeId: itemTime?.id ?? null,
          title: item.raw_title,
          sectionKey: item.section_key,
          elementKey: item.element_key,
          plannedSeconds: item.planned_seconds,
          actualSeconds: itemTime?.actual_seconds ?? null,
        })),
        occurrenceItems:
          incident.plan_time_id === null
            ? []
            : (planItemsByPlanId.get(plan.id) ?? []).map((item) => ({
                id: item.id,
                sequence: item.sequence,
                title: item.raw_title,
                itemType: item.item_type,
                servicePosition: item.service_position,
                sectionKey: item.section_key,
                elementKey: item.element_key,
                plannedSeconds: item.planned_seconds,
                actualSeconds:
                  itemTimeByPlanTimeAndItemId.get(`${incident.plan_time_id}:${item.id}`)
                    ?.actual_seconds ?? null,
              })),
      };
    })
    .filter((incident): incident is OpenReviewIncident => Boolean(incident));
}

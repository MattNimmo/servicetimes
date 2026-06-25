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
  review_incident_items: Array<{ item_id: number | string }>;
};

type PlanTimeRow = {
  id: number;
  plan_id: number;
  pco_name: string | null;
  starts_at: string | null;
  live_starts_at: string | null;
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
  slot_label: string;
};

type ItemRow = {
  id: number;
  raw_title: string;
  section_key: string | null;
  element_key: string | null;
  planned_seconds: number | null;
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
  slotLabel: string | null;
  itemCount: number;
  items: Array<{
    id: number;
    title: string;
    sectionKey: string | null;
    elementKey: string | null;
    plannedSeconds: number | null;
  }>;
};

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
      "id,plan_id,plan_time_id,slot_id,kind,detail,evidence,opened_at,review_incident_items(item_id)",
    order: "opened_at.asc",
  });

  const planTimes = await readByIds<PlanTimeRow>(
    "plan_times",
    uniqueNumbers(incidents.map(({ plan_time_id }) => plan_time_id)),
    "id,plan_id,pco_name,starts_at,live_starts_at",
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

  const [campuses, slots, items] = await Promise.all([
    readByIds<CampusRow>(
      "campuses",
      uniqueNumbers(plans.map(({ campus_id }) => campus_id)),
      "id,code,name",
    ),
    readByIds<SlotRow>(
      "service_slots",
      uniqueNumbers(incidents.map(({ slot_id }) => slot_id)),
      "id,slot_label",
    ),
    readByIds<ItemRow>(
      "items",
      uniqueNumbers(
        incidents.flatMap(({ review_incident_items }) =>
          review_incident_items.map(({ item_id }) => Number(item_id)),
        ),
      ),
      "id,raw_title,section_key,element_key,planned_seconds",
    ),
  ]);

  const campusById = new Map(campuses.map((campus) => [campus.id, campus]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const itemById = new Map(items.map((item) => [item.id, item]));

  return incidents
    .map((incident) => {
      const planTime =
        incident.plan_time_id === null ? null : planTimeById.get(incident.plan_time_id);
      const planId = incident.plan_id ?? planTime?.plan_id ?? null;
      const plan = planId === null ? undefined : planById.get(planId);
      const campus = plan ? campusById.get(plan.campus_id) : undefined;
      if (!plan || !campus) return null;

      const incidentItems = incident.review_incident_items
        .map(({ item_id }) => itemById.get(Number(item_id)))
        .filter((item): item is ItemRow => Boolean(item));

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
        slotLabel:
          incident.slot_id === null
            ? null
            : (slotById.get(incident.slot_id)?.slot_label ?? null),
        itemCount: incident.review_incident_items.length,
        items: incidentItems.map((item) => ({
          id: item.id,
          title: item.raw_title,
          sectionKey: item.section_key,
          elementKey: item.element_key,
          plannedSeconds: item.planned_seconds,
        })),
      };
    })
    .filter((incident): incident is OpenReviewIncident => Boolean(incident));
}

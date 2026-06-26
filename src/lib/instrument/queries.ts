import "server-only";

import { readRows } from "@/lib/supabase/rest";
import {
  computeVariance,
  isElementBlocked,
  isSlotBlocked,
  type ReviewIncident,
  type VarianceValue,
} from "@/lib/variance/queries";

export type CampusCode = "SLP" | "MG" | "ELK" | "LV";
export type WorkbenchHorizon = "last" | "6wk" | "6mo" | "12mo";
export type PhaseKey = "worship_open" | "mid_service" | "live" | "local";

export type PhaseBreakdown = Record<
  PhaseKey,
  { plannedSeconds: number; actualSeconds: number | null }
>;

export type ServiceSlotSummary = {
  slotId: number;
  slotLabel: string;
  expectedLocalStart: string | null;
  planTimeId: number;
  plannedSeconds: number | null;
  actualSeconds: number | null;
  broadcastStartsAt: string | null;
  broadcastEndsAt: string | null;
  isBlocked: boolean;
  variance: VarianceValue;
};

export type GlanceCampus = {
  code: CampusCode;
  name: string;
  referenceTargetSeconds: number;
  serviceDate: string;
  planId: number;
  slots: ServiceSlotSummary[];
  phases: PhaseBreakdown;
  openIncidentCount: number;
  unmappedCount: number;
};

export type WorkbenchElementRow = {
  elementKey: string;
  elementName: string;
  sectionKey: string;
  sectionName: string;
  sectionSortOrder: number;
  elementSortOrder: number;
  plannedSeconds: number;
  actualSeconds: number | null;
  actualIsComplete: boolean;
  isBlocked: boolean;
  isHumanAdjusted: boolean;
  variance: VarianceValue;
};

export type TrendPoint = {
  serviceDate: string;
  plannedSeconds: number | null;
  actualSeconds: number | null;
  isMoment: boolean;
};

export type CrossCampusMedian = {
  campusCode: CampusCode;
  elementKey: string;
  medianSeconds: number | null;
  isActive: boolean;
};

export type WorkbenchData = {
  campus: { code: CampusCode; name: string };
  serviceDate: string;
  planId: number;
  slot: ServiceSlotSummary;
  availableSlotLabels: string[];
  phases: PhaseBreakdown;
  elements: WorkbenchElementRow[];
  trend: TrendPoint[];
  allCampusMedians: CrossCampusMedian[];
  referenceTargetSeconds: number;
};

type CampusRow = {
  id: number;
  code: CampusCode;
  name: string;
  reference_target_seconds: number;
};

type PlanRow = {
  id: number;
  campus_id: number;
  service_date: string;
  title: string | null;
  series_title: string | null;
  sort_date: string;
};

type ServiceSlotRow = {
  id: number;
  campus_id: number;
  slot_label: string;
  expected_local_start: string;
  is_active: boolean;
};

type EffectivePlanTimeRow = {
  id: number;
  plan_id: number;
  effective_slot_id: number;
  time_type: string;
  is_manually_excluded: boolean;
  planned_target_seconds: number | null;
  actual_service_seconds: number | null;
  live_starts_at: string | null;
  live_ends_at: string | null;
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

type PlanTimeIdRow = { id: number };
type UnmappedItemRow = { id: number };

const PHASE_KEYS: PhaseKey[] = ["worship_open", "mid_service", "live", "local"];

function emptyPhaseBreakdown(): PhaseBreakdown {
  return {
    worship_open: { plannedSeconds: 0, actualSeconds: 0 },
    mid_service: { plannedSeconds: 0, actualSeconds: 0 },
    live: { plannedSeconds: 0, actualSeconds: 0 },
    local: { plannedSeconds: 0, actualSeconds: 0 },
  };
}

function addMaybeSeconds(left: number | null, right: number | null) {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[mid]
    : Math.round((ordered[mid - 1] + ordered[mid]) / 2);
}

async function listCampusesWithTargets() {
  return readRows<CampusRow>("campuses", {
    select: "id,code,name,reference_target_seconds",
    order: "code.asc",
  });
}

async function campusByCode(code: string) {
  const rows = await readRows<CampusRow>("campuses", {
    code: `eq.${code.toUpperCase()}`,
    select: "id,code,name,reference_target_seconds",
    limit: "1",
  });
  return rows[0] ?? null;
}

async function latestPlan(campusId: number) {
  const plans = await readRows<PlanRow>("plans", {
    campus_id: `eq.${campusId}`,
    select: "id,campus_id,service_date,title,series_title,sort_date",
    order: "service_date.desc,sort_date.desc",
    limit: "1",
  });
  return plans[0] ?? null;
}

async function plansForHorizon(campusId: number, horizon: WorkbenchHorizon) {
  const limit =
    horizon === "last" ? 1 : horizon === "6wk" ? 6 : horizon === "6mo" ? 26 : 52;
  return readRows<PlanRow>("plans", {
    campus_id: `eq.${campusId}`,
    select: "id,campus_id,service_date,title,series_title,sort_date",
    order: "service_date.desc,sort_date.desc",
    limit: String(limit),
  });
}

async function serviceSlots(campusId: number) {
  return readRows<ServiceSlotRow>("service_slots", {
    campus_id: `eq.${campusId}`,
    is_active: "eq.true",
    select: "id,campus_id,slot_label,expected_local_start,is_active",
    order: "expected_local_start.asc",
  });
}

async function allPlanTimeIds(planId: number) {
  return readRows<PlanTimeIdRow>("plan_times", {
    plan_id: `eq.${planId}`,
    select: "id",
  });
}

async function effectivePlanTimes(planId: number) {
  return readRows<EffectivePlanTimeRow>("effective_plan_times", {
    plan_id: `eq.${planId}`,
    effective_slot_id: "not.is.null",
    time_type: "eq.service",
    is_manually_excluded: "eq.false",
    select:
      "id,plan_id,effective_slot_id,time_type,is_manually_excluded,planned_target_seconds,actual_service_seconds,live_starts_at,live_ends_at",
    order: "live_starts_at.asc",
  });
}

async function elementVariance(planId: number) {
  return readRows<ElementVarianceRow>("element_variance", {
    plan_id: `eq.${planId}`,
    select: "*",
    order: "section_sort_order.asc,element_sort_order.asc",
  });
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

async function unmappedItems(campus: CampusCode, serviceDate: string) {
  return readRows<UnmappedItemRow>("unmapped_items", {
    campus: `eq.${campus}`,
    service_date: `eq.${serviceDate}`,
    select: "id",
  });
}

function buildPhaseBreakdown(rows: ElementVarianceRow[]) {
  const phases = emptyPhaseBreakdown();
  for (const row of rows) {
    if (!PHASE_KEYS.includes(row.section_key as PhaseKey)) continue;
    const key = row.section_key as PhaseKey;
    phases[key].plannedSeconds += row.planned_seconds;
    phases[key].actualSeconds = addMaybeSeconds(phases[key].actualSeconds, row.actual_seconds);
  }
  return phases;
}

function buildSlotSummaries(
  rows: EffectivePlanTimeRow[],
  slots: ServiceSlotRow[],
  incidents: ReviewIncident[],
  referenceTargetSeconds: number,
): ServiceSlotSummary[] {
  return rows
    .map((row) => {
      const slot = slots.find(({ id }) => id === row.effective_slot_id);
      const isBlocked = isSlotBlocked(incidents, row.id, row.effective_slot_id);
      return {
        slotId: row.effective_slot_id,
        slotLabel: slot?.slot_label ?? "Unknown slot",
        expectedLocalStart: slot?.expected_local_start ?? null,
        planTimeId: row.id,
        plannedSeconds: row.planned_target_seconds,
        actualSeconds: row.actual_service_seconds,
        broadcastStartsAt: row.live_starts_at,
        broadcastEndsAt: row.live_ends_at,
        isBlocked,
        variance: computeVariance(
          referenceTargetSeconds,
          row.actual_service_seconds,
          isBlocked || row.actual_service_seconds === null,
        ),
      };
    })
    .sort((left, right) =>
      (left.expectedLocalStart ?? "").localeCompare(right.expectedLocalStart ?? ""),
    );
}

export async function getTriageBadgeCount() {
  const campuses = await listCampusesWithTargets();
  const results = await Promise.all(
    campuses.map(async (campus) => {
      const plan = await latestPlan(campus.id);
      if (!plan) return 0;
      const [planTimeRows, unmapped] = await Promise.all([
        allPlanTimeIds(plan.id),
        unmappedItems(campus.code, plan.service_date),
      ]);
      const incidents = await openIncidents(
        plan.id,
        planTimeRows.map(({ id }) => id),
      );
      return incidents.length + unmapped.length;
    }),
  );

  return results.reduce((sum, value) => sum + value, 0);
}

export async function getGlanceData(): Promise<GlanceCampus[]> {
  const campuses = await listCampusesWithTargets();
  const results = await Promise.all(
    campuses.map(async (campus) => {
      const plan = await latestPlan(campus.id);
      if (!plan) return null;

      const [slotRows, planTimeRows, elementRows, everyPlanTime, unmapped] = await Promise.all([
        serviceSlots(campus.id),
        effectivePlanTimes(plan.id),
        elementVariance(plan.id),
        allPlanTimeIds(plan.id),
        unmappedItems(campus.code, plan.service_date),
      ]);
      const incidents = await openIncidents(
        plan.id,
        everyPlanTime.map(({ id }) => id),
      );

      return {
        code: campus.code,
        name: campus.name,
        referenceTargetSeconds: campus.reference_target_seconds,
        serviceDate: plan.service_date,
        planId: plan.id,
        slots: buildSlotSummaries(
          planTimeRows,
          slotRows,
          incidents,
          campus.reference_target_seconds,
        ),
        phases: buildPhaseBreakdown(elementRows),
        openIncidentCount: incidents.length,
        unmappedCount: unmapped.length,
      } satisfies GlanceCampus;
    }),
  );

  return results.filter((value): value is GlanceCampus => value !== null);
}

export async function getWorkbenchData(
  campusCode: string,
  slotLabel: string,
  horizon: WorkbenchHorizon,
): Promise<WorkbenchData | null> {
  const campus = await campusByCode(campusCode);
  if (!campus) return null;

  const slotRows = await serviceSlots(campus.id);
  const selectedSlot = slotRows.find(
    (slot) => slot.slot_label.toLowerCase() === slotLabel.toLowerCase(),
  );
  if (!selectedSlot) return null;

  const plans = await plansForHorizon(campus.id, horizon);
  const latest = plans[0];
  if (!latest) return null;

  const [currentPlanTimes, currentElements, everyPlanTime] = await Promise.all([
    effectivePlanTimes(latest.id),
    elementVariance(latest.id),
    allPlanTimeIds(latest.id),
  ]);

  const incidents = await openIncidents(
    latest.id,
    everyPlanTime.map(({ id }) => id),
  );
  const slotSummary = buildSlotSummaries(
    currentPlanTimes.filter((row) => row.effective_slot_id === selectedSlot.id),
    slotRows,
    incidents,
    campus.reference_target_seconds,
  )[0];
  if (!slotSummary) return null;

  const slotElements = currentElements
    .filter((row) => row.effective_slot_id === selectedSlot.id)
    .map((row) => ({
      elementKey: row.element_key,
      elementName: row.element_name,
      sectionKey: row.section_key,
      sectionName: row.section_name,
      sectionSortOrder: row.section_sort_order,
      elementSortOrder: row.element_sort_order,
      plannedSeconds: row.planned_seconds,
      actualSeconds: row.actual_seconds,
      actualIsComplete: row.actual_is_complete,
      isBlocked: !row.actual_is_complete ||
        isElementBlocked(
          incidents,
          row.plan_time_id,
          row.effective_slot_id,
          row.item_ids,
        ),
      isHumanAdjusted: false,
      variance: computeVariance(
        row.planned_seconds,
        row.actual_seconds,
        !row.actual_is_complete ||
          isElementBlocked(
            incidents,
            row.plan_time_id,
            row.effective_slot_id,
            row.item_ids,
          ),
      ),
    }))
    .sort(
      (left, right) =>
        left.sectionSortOrder - right.sectionSortOrder ||
        left.elementSortOrder - right.elementSortOrder,
    );

  const phases = buildPhaseBreakdown(
    currentElements.filter((row) => row.effective_slot_id === selectedSlot.id),
  );

  const trend = (
    await Promise.all(
      plans.map(async (plan) => {
        const [planTimeRows, planTimeIds] = await Promise.all([
          effectivePlanTimes(plan.id),
          allPlanTimeIds(plan.id),
        ]);
        const matching = planTimeRows.find(
          (row) => row.effective_slot_id === selectedSlot.id,
        );
        if (!matching) return null;
        const planIncidents = await openIncidents(
          plan.id,
          planTimeIds.map(({ id }) => id),
        );
        return {
          serviceDate: plan.service_date,
          plannedSeconds: matching.planned_target_seconds,
          actualSeconds: isSlotBlocked(planIncidents, matching.id, matching.effective_slot_id)
            ? null
            : matching.actual_service_seconds,
          isMoment: planIncidents.length > 0,
        } satisfies TrendPoint;
      }),
    )
  )
    .filter((value): value is TrendPoint => value !== null)
    .reverse();

  const mediansByCampus = new Map<CampusCode, number | null>();
  await Promise.all(
    (["ELK", "LV", "MG", "SLP"] as CampusCode[]).map(async (code) => {
      const otherCampus = await campusByCode(code);
      if (!otherCampus) {
        mediansByCampus.set(code, null);
        return;
      }
      const otherPlans = await plansForHorizon(otherCampus.id, "6wk");
      const values: number[] = [];
      for (const plan of otherPlans) {
        const rows = await elementVariance(plan.id);
        const match = rows.find(
          (row) =>
            row.element_key === "mid.close_worship" &&
            row.actual_seconds !== null,
        );
        if (match && match.actual_seconds !== null) values.push(match.actual_seconds);
      }
      mediansByCampus.set(code, median(values));
    }),
  );

  return {
    campus: { code: campus.code, name: campus.name },
    serviceDate: latest.service_date,
    planId: latest.id,
    slot: slotSummary,
    availableSlotLabels: slotRows.map((slot) => slot.slot_label),
    phases,
    elements: slotElements,
    trend,
    allCampusMedians: (["ELK", "LV", "MG", "SLP"] as CampusCode[]).map((code) => ({
      campusCode: code,
      elementKey: "mid.close_worship",
      medianSeconds: mediansByCampus.get(code) ?? null,
      isActive: code === campus.code,
    })),
    referenceTargetSeconds: campus.reference_target_seconds,
  };
}

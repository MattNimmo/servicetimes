import "server-only";

import { readRows } from "@/lib/supabase/rest";
import { isSlotBlocked, type ReviewIncident } from "@/lib/variance/queries";

export type CampusCode = "SLP" | "MG" | "ELK" | "LV";
export type PhaseKey = "worship_open" | "mid_service" | "live" | "local";

export type PhaseBreakdown = Record<
  PhaseKey,
  { plannedSeconds: number; actualSeconds: number | null }
>;

export type ServiceSlotSummary = {
  slotId: number;
  slotLabel: string;
  planTimeId: number;
  plannedSeconds: number | null;
  actualSeconds: number | null;
  broadcastStartsAt: string | null;
  broadcastEndsAt: string | null;
  isBlocked: boolean;
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
};

type EffectivePlanTimeRow = {
  id: number;
  effective_slot_id: number;
  planned_target_seconds: number | null;
  actual_service_seconds: number | null;
  live_starts_at: string | null;
  live_ends_at: string | null;
};

type ServiceSlotRow = {
  id: number;
  slot_label: string;
  expected_local_start: string;
  is_active: boolean;
};

type ElementVarianceRow = {
  section_key: string;
  planned_seconds: number;
  actual_seconds: number | null;
};

type ActivePlanTimeCorrection = {
  plan_time_id: number;
  corrected_actual_seconds: number | null;
};

const CAMPUS_ORDER: CampusCode[] = ["SLP", "MG", "ELK", "LV"];
const PHASE_KEYS: PhaseKey[] = ["worship_open", "mid_service", "live", "local"];

function campusSortIndex(code: CampusCode) {
  const index = CAMPUS_ORDER.indexOf(code);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function sumNullable(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (numbers.length === 0) return null;
  return numbers.reduce((total, value) => total + value, 0);
}

async function listInstrumentCampuses() {
  const campuses = await readRows<CampusRow>("campuses", {
    select: "id,code,name,reference_target_seconds",
    order: "code.asc",
  });

  return campuses.sort(
    (left, right) => campusSortIndex(left.code) - campusSortIndex(right.code),
  );
}

async function latestPlanForCampus(campusId: number) {
  const rows = await readRows<PlanRow>("plans", {
    campus_id: `eq.${campusId}`,
    select: "id,campus_id,service_date",
    order: "service_date.desc,sort_date.desc",
    limit: "1",
  });

  return rows[0] ?? null;
}

async function allPlanTimeIds(planId: number) {
  return readRows<{ id: number }>("plan_times", {
    plan_id: `eq.${planId}`,
    select: "id",
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

async function activePlanTimeCorrections(planTimeIds: number[]) {
  if (planTimeIds.length === 0) return [];

  return readRows<ActivePlanTimeCorrection>("active_plan_time_corrections", {
    plan_time_id: `in.(${planTimeIds.join(",")})`,
    select: "plan_time_id,corrected_actual_seconds",
  });
}

async function unmappedCount(campusCode: string, serviceDate: string) {
  const rows = await readRows<{ id: number }>("unmapped_items", {
    campus: `eq.${campusCode}`,
    service_date: `eq.${serviceDate}`,
    select: "id",
  });

  return rows.length;
}

function emptyPhaseBreakdown(): PhaseBreakdown {
  return {
    worship_open: { plannedSeconds: 0, actualSeconds: null },
    mid_service: { plannedSeconds: 0, actualSeconds: null },
    live: { plannedSeconds: 0, actualSeconds: null },
    local: { plannedSeconds: 0, actualSeconds: null },
  };
}

function buildPhaseBreakdown(rows: ElementVarianceRow[]) {
  const phases = emptyPhaseBreakdown();

  for (const phase of PHASE_KEYS) {
    const phaseRows = rows.filter((row) => row.section_key === phase);
    phases[phase] = {
      plannedSeconds: phaseRows.reduce((total, row) => total + row.planned_seconds, 0),
      actualSeconds: sumNullable(phaseRows.map((row) => row.actual_seconds)),
    };
  }

  return phases;
}

async function buildCampusGlance(campus: CampusRow): Promise<GlanceCampus | null> {
  const plan = await latestPlanForCampus(campus.id);
  if (!plan) return null;

  const [planTimes, everyPlanTime, slots, elements, unmapped] = await Promise.all([
    readRows<EffectivePlanTimeRow>("effective_plan_times", {
      plan_id: `eq.${plan.id}`,
      effective_slot_id: "not.is.null",
      time_type: "eq.service",
      is_manually_excluded: "eq.false",
      select:
        "id,effective_slot_id,planned_target_seconds,actual_service_seconds,live_starts_at,live_ends_at",
    }),
    allPlanTimeIds(plan.id),
    readRows<ServiceSlotRow>("service_slots", {
      campus_id: `eq.${campus.id}`,
      is_active: "eq.true",
      select: "id,slot_label,expected_local_start,is_active",
      order: "expected_local_start.asc",
    }),
    readRows<ElementVarianceRow>("element_variance", {
      plan_id: `eq.${plan.id}`,
      select: "section_key,planned_seconds,actual_seconds",
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
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  const summaries = planTimes
    .map((planTime) => {
      const slot = slotById.get(planTime.effective_slot_id);
      if (!slot) return null;

      return {
        slotId: slot.id,
        slotLabel: slot.slot_label,
        planTimeId: planTime.id,
        plannedSeconds: planTime.planned_target_seconds,
        actualSeconds:
          correctionByPlanTimeId.get(planTime.id)?.corrected_actual_seconds ??
          planTime.actual_service_seconds,
        broadcastStartsAt: planTime.live_starts_at,
        broadcastEndsAt: planTime.live_ends_at,
        isBlocked: isSlotBlocked(incidents, planTime.id, slot.id),
        expectedLocalStart: slot.expected_local_start,
      };
    })
    .filter(
      (summary): summary is ServiceSlotSummary & { expectedLocalStart: string } =>
        summary !== null,
    )
    .sort((left, right) => left.expectedLocalStart.localeCompare(right.expectedLocalStart))
    .map((summary) => ({
      slotId: summary.slotId,
      slotLabel: summary.slotLabel,
      planTimeId: summary.planTimeId,
      plannedSeconds: summary.plannedSeconds,
      actualSeconds: summary.actualSeconds,
      broadcastStartsAt: summary.broadcastStartsAt,
      broadcastEndsAt: summary.broadcastEndsAt,
      isBlocked: summary.isBlocked,
    }));

  return {
    code: campus.code,
    name: campus.name,
    referenceTargetSeconds: campus.reference_target_seconds,
    serviceDate: plan.service_date,
    planId: plan.id,
    slots: summaries,
    phases: buildPhaseBreakdown(elements),
    openIncidentCount: incidents.length,
    unmappedCount: unmapped,
  };
}

export async function getGlanceData(): Promise<GlanceCampus[]> {
  const campuses = await listInstrumentCampuses();
  const results = await Promise.all(campuses.map((campus) => buildCampusGlance(campus)));

  return results.filter((result): result is GlanceCampus => result !== null);
}

export async function getTriageBadgeCount() {
  const campuses = await listInstrumentCampuses();
  const results = await Promise.all(
    campuses.map(async (campus) => {
      const plan = await latestPlanForCampus(campus.id);
      if (!plan) return 0;

      const [planTimeIds, unmapped] = await Promise.all([
        allPlanTimeIds(plan.id),
        unmappedCount(campus.code, plan.service_date),
      ]);
      const incidents = await openIncidents(
        plan.id,
        planTimeIds.map(({ id }) => id),
      );

      return incidents.length + unmapped;
    }),
  );

  return results.reduce((total, value) => total + value, 0);
}

import "server-only";

import { readRows } from "@/lib/supabase/rest";
import { isElementBlocked, isSlotBlocked, type ReviewIncident } from "@/lib/variance/queries";

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

// ─── Workbench ────────────────────────────────────────────────────────────────

export type WorkbenchHorizon = "last" | "6wk" | "6mo" | "12mo";

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
};

export type TrendPoint = {
  serviceDate: string;
  plannedSeconds: number | null;
  actualSeconds: number | null;
  midActualSeconds: number | null;
  midPlannedSeconds: number | null;
  messageActualSeconds: number | null;
  messagePlannedSeconds: number | null;
  worshipActualSeconds: number | null;
  worshipPlannedSeconds: number | null;
  isMoment: boolean;
};

export type CrossCampusMedian = {
  campusCode: CampusCode;
  medianSeconds: number | null;
  isActive: boolean;
};

export type WorkbenchData = {
  campus: { code: CampusCode; name: string };
  serviceDate: string;
  planId: number;
  slot: ServiceSlotSummary;
  phases: PhaseBreakdown;
  elements: WorkbenchElementRow[];
  trend: TrendPoint[];
  allCampusMedians: CrossCampusMedian[];
  referenceTargetSeconds: number;
  availableSlots: Array<{ id: number; label: string; expectedLocalStart: string }>;
};

// ─── Triage ───────────────────────────────────────────────────────────────────

export type SlotIncident = {
  id: number;
  kind: string;
  planTimeId: number;
  canCorrectPlanTimeActual: boolean;
  canResolveSlotResolution: boolean;
  rawActualSeconds: number | null;
  plannedSeconds: number | null;
  availableSlots: Array<{ id: number; label: string }>;
};

export type TriageItemStatus =
  | "good"
  | "not_tracked"
  | "rolled_up"
  | "unmapped"
  | "incident"
  | "resolved";

export type TriageItemIncident = {
  id: number;
  kind: string;
  canCorrectPlanTimeActual: boolean;
  canCorrectItemTimes: boolean;
  itemTimeId: number | null;
  rawActualSeconds: number | null;
  plannedSeconds: number | null;
};

export type TriageItem = {
  id: number;
  sequence: number;
  rawTitle: string;
  itemType: "song" | "header" | "media" | "item";
  servicePosition: "pre" | "during" | "post" | null;
  sectionKey: string | null;
  elementKey: string | null;
  plannedSeconds: number | null;
  actualSeconds: number | null;
  status: TriageItemStatus;
  incident: TriageItemIncident | null;
};

export type TriageSection = {
  sectionKey: string;
  sectionLabel: string;
  sectionSortOrder: number;
  items: TriageItem[];
};

export type TriageSlot = {
  planTimeId: number;
  slotLabel: string;
  pcoName: string | null;
  startsAt: string | null;
  slotIncidents: SlotIncident[];
  sections: TriageSection[];
};

export type AvailableElement = {
  key: string;
  sectionKey: string;
  displayName: string;
};

export type TriageData = {
  campus: { code: CampusCode; name: string };
  serviceDate: string;
  planTitle: string;
  slots: TriageSlot[];
  totalAttentionCount: number;
  availableElements: AvailableElement[];
};

// ─── Private helpers ─────────────────────────────────────────────────────────

async function campusByCode(code: string): Promise<CampusRow | null> {
  const rows = await readRows<CampusRow>("campuses", {
    code: `eq.${code.toUpperCase()}`,
    select: "id,code,name,reference_target_seconds",
    limit: "1",
  });
  return rows[0] ?? null;
}


function median(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 !== 0 ? nums[mid] : nums[mid - 1];
}

type TriageIncident = {
  id: number;
  plan_time_id: number;
  slot_id: number | null;
  kind: string;
  review_incident_items: Array<{ item_id: number; item_time_id: number | null }>;
};

async function openTriageIncidents(planTimeIds: number[]): Promise<TriageIncident[]> {
  if (planTimeIds.length === 0) return [];
  return readRows<TriageIncident>("review_incidents", {
    status: "eq.open",
    plan_time_id: `in.(${planTimeIds.join(",")})`,
    select: "id,plan_time_id,slot_id,kind,review_incident_items(item_id,item_time_id)",
  });
}

type FullElementVarianceRow = {
  element_key: string;
  element_name: string;
  section_key: string;
  section_name: string;
  section_sort_order: number;
  element_sort_order: number;
  item_ids: number[];
  planned_seconds: number;
  actual_seconds: number | null;
  actual_is_complete: boolean;
  plan_time_id: number;
  effective_slot_id: number;
};

type TriagePlanTimeRow = {
  id: number;
  effective_slot_id: number;
  pco_name: string | null;
  starts_at: string | null;
  planned_target_seconds: number | null;
  actual_service_seconds: number | null;
};

type TriageItemRow = {
  id: number;
  sequence: number;
  raw_title: string;
  item_type: string;
  service_position: string | null;
  section_key: string | null;
  element_key: string | null;
  planned_seconds: number | null;
  is_rollup_child: boolean;
};

type TriageItemTimeRow = {
  id: number;
  item_id: number;
  plan_time_id: number;
  actual_seconds: number | null;
};

const SLOT_BLOCKING_KINDS = new Set([
  "slot_resolution",
  "missing_live_bounds",
  "zero_live_window",
  "reconciliation_gap",
]);

const SECTION_LABELS: Record<string, string> = {
  pre_service: "PRE SERVICE",
  worship_open: "PRAISE & WORSHIP",
  mid_service: "MID SERVICE",
  live: "LIVE TIME",
  local: "LOCATION DISCONNECT",
  post_service: "ONLINE DISCONNECT",
};

const SECTION_ORDER = [
  "pre_service",
  "worship_open",
  "mid_service",
  "live",
  "local",
  "post_service",
];

// ─── getWorkbenchData ─────────────────────────────────────────────────────────

export async function getWorkbenchData(
  campusCode: string,
  slotLabel: string,
  horizon: WorkbenchHorizon,
): Promise<WorkbenchData | null> {
  const campus = await campusByCode(campusCode);
  if (!campus) return null;

  const allSlots = await readRows<ServiceSlotRow>("service_slots", {
    campus_id: `eq.${campus.id}`,
    is_active: "eq.true",
    select: "id,slot_label,expected_local_start,is_active",
    order: "expected_local_start.asc",
  });

  const slot = allSlots.find((s) => s.slot_label === slotLabel) ?? allSlots[0];
  if (!slot) return null;

  const horizonLimit = { last: 1, "6wk": 6, "6mo": 26, "12mo": 52 }[horizon];

  const plans = await readRows<PlanRow>("plans", {
    campus_id: `eq.${campus.id}`,
    select: "id,campus_id,service_date",
    order: "service_date.desc",
    limit: String(horizonLimit),
  });

  if (plans.length === 0) return null;

  const latestPlan = plans[0];

  const [elements, planTimesForSlot, allIds] = await Promise.all([
    readRows<FullElementVarianceRow>("element_variance", {
      plan_id: `eq.${latestPlan.id}`,
      effective_slot_id: `eq.${slot.id}`,
      select:
        "element_key,element_name,section_key,section_name,section_sort_order,element_sort_order,item_ids,planned_seconds,actual_seconds,actual_is_complete,plan_time_id,effective_slot_id",
      order: "section_sort_order.asc,element_sort_order.asc",
    }),
    readRows<{ id: number; planned_target_seconds: number | null; actual_service_seconds: number | null; live_starts_at: string | null; live_ends_at: string | null }>(
      "effective_plan_times",
      {
        plan_id: `eq.${latestPlan.id}`,
        effective_slot_id: `eq.${slot.id}`,
        is_manually_excluded: "eq.false",
        time_type: "eq.service",
        select: "id,planned_target_seconds,actual_service_seconds,live_starts_at,live_ends_at",
      },
    ),
    allPlanTimeIds(latestPlan.id),
  ]);

  const latestPlanTime = planTimesForSlot[0] ?? null;

  const [incidents, corrections, slotItemTimes] = await Promise.all([
    openIncidents(latestPlan.id, allIds.map(({ id }) => id)),
    activePlanTimeCorrections(planTimesForSlot.map(({ id }) => id)),
    latestPlanTime
      ? readRows<{ id: number; item_id: number }>("item_times", {
          plan_time_id: `eq.${latestPlanTime.id}`,
          select: "id,item_id",
        })
      : Promise.resolve([] as Array<{ id: number; item_id: number }>),
  ]);

  // Which items in this slot have an active item-time correction (→ ADJ chip)
  const activeItemTimeCorrs =
    slotItemTimes.length > 0
      ? await readRows<{ item_time_id: number }>("active_item_time_corrections", {
          item_time_id: `in.(${slotItemTimes.map((it) => it.id).join(",")})`,
          select: "item_time_id",
        })
      : [];
  const correctedItemTimeIds = new Set(activeItemTimeCorrs.map((c) => c.item_time_id));
  const adjustedItemIds = new Set(
    slotItemTimes.filter((it) => correctedItemTimeIds.has(it.id)).map((it) => it.item_id),
  );

  const correctionMap = new Map(corrections.map((c) => [c.plan_time_id, c]));

  const actualSecondsForSlot = latestPlanTime
    ? (correctionMap.get(latestPlanTime.id)?.corrected_actual_seconds ??
        latestPlanTime.actual_service_seconds)
    : null;

  const slotSummary: ServiceSlotSummary = {
    slotId: slot.id,
    slotLabel: slot.slot_label,
    planTimeId: latestPlanTime?.id ?? 0,
    plannedSeconds: latestPlanTime?.planned_target_seconds ?? null,
    actualSeconds: actualSecondsForSlot,
    broadcastStartsAt: latestPlanTime?.live_starts_at ?? null,
    broadcastEndsAt: latestPlanTime?.live_ends_at ?? null,
    isBlocked: latestPlanTime
      ? isSlotBlocked(incidents, latestPlanTime.id, slot.id)
      : false,
  };

  const elementRows: WorkbenchElementRow[] = elements.map((ev) => ({
    elementKey: ev.element_key,
    elementName: ev.element_name,
    sectionKey: ev.section_key,
    sectionName: ev.section_name,
    sectionSortOrder: ev.section_sort_order,
    elementSortOrder: ev.element_sort_order,
    plannedSeconds: ev.planned_seconds,
    actualSeconds: ev.actual_seconds,
    actualIsComplete: ev.actual_is_complete,
    isBlocked: isElementBlocked(incidents, ev.plan_time_id, ev.effective_slot_id, ev.item_ids),
    isHumanAdjusted: ev.item_ids.some((id) => adjustedItemIds.has(id)),
  }));

  // Build trend data with bulk queries (5 queries regardless of horizon depth)
  const allPlanIds = plans.map((p) => p.id);
  type TrendPlanTimeRow = { id: number; plan_id: number; planned_target_seconds: number | null; actual_service_seconds: number | null };
  type TrendElementRow = { plan_id: number; actual_seconds: number | null; planned_seconds: number };

  const [allTrendPlanTimes, allMidVariance, allMessageVariance, allWorshipVariance] =
    await Promise.all([
      readRows<TrendPlanTimeRow>("effective_plan_times", {
        plan_id: `in.(${allPlanIds.join(",")})`,
        effective_slot_id: `eq.${slot.id}`,
        is_manually_excluded: "eq.false",
        time_type: "eq.service",
        select: "id,plan_id,planned_target_seconds,actual_service_seconds",
      }),
      readRows<TrendElementRow>("element_variance", {
        plan_id: `in.(${allPlanIds.join(",")})`,
        effective_slot_id: `eq.${slot.id}`,
        section_key: "eq.mid_service",
        select: "plan_id,actual_seconds,planned_seconds",
      }),
      readRows<TrendElementRow>("element_variance", {
        plan_id: `in.(${allPlanIds.join(",")})`,
        effective_slot_id: `eq.${slot.id}`,
        element_key: "eq.live.message",
        select: "plan_id,actual_seconds,planned_seconds",
      }),
      readRows<TrendElementRow>("element_variance", {
        plan_id: `in.(${allPlanIds.join(",")})`,
        effective_slot_id: `eq.${slot.id}`,
        element_key: "eq.worship.open",
        select: "plan_id,actual_seconds,planned_seconds",
      }),
    ]);

  const allTrendPlanTimeIds = allTrendPlanTimes.map((pt) => pt.id);
  const trendIncidents =
    allTrendPlanTimeIds.length > 0
      ? await readRows<{ plan_time_id: number }>("review_incidents", {
          plan_time_id: `in.(${allTrendPlanTimeIds.join(",")})`,
          status: "eq.open",
          select: "plan_time_id",
        })
      : [];

  const trendPtByPlanId = new Map(
    allTrendPlanTimes.map((pt) => [pt.plan_id, pt]),
  );
  const blockedTrendPtIds = new Set(trendIncidents.map((inc) => inc.plan_time_id));

  // Aggregate mid_service section: sum actuals and planned across all elements per plan
  const midByPlanId = new Map<number, { actualSeconds: number | null; plannedSeconds: number }>();
  for (const row of allMidVariance) {
    const existing = midByPlanId.get(row.plan_id);
    if (!existing) {
      midByPlanId.set(row.plan_id, {
        actualSeconds: row.actual_seconds,
        plannedSeconds: row.planned_seconds,
      });
    } else {
      const sumActual =
        existing.actualSeconds !== null && row.actual_seconds !== null
          ? existing.actualSeconds + row.actual_seconds
          : (existing.actualSeconds ?? row.actual_seconds);
      midByPlanId.set(row.plan_id, {
        actualSeconds: sumActual,
        plannedSeconds: existing.plannedSeconds + row.planned_seconds,
      });
    }
  }
  // Single-element lookups (one row per plan)
  const messageByPlanId = new Map(allMessageVariance.map((r) => [r.plan_id, r]));
  const worshipByPlanId = new Map(allWorshipVariance.map((r) => [r.plan_id, r]));

  const trendPoints: TrendPoint[] = plans
    .map((plan) => {
      const pt = trendPtByPlanId.get(plan.id) ?? null;
      if (!pt) {
        return {
          serviceDate: plan.service_date,
          plannedSeconds: null,
          actualSeconds: null,
          midActualSeconds: null,
          midPlannedSeconds: null,
          messageActualSeconds: null,
          messagePlannedSeconds: null,
          worshipActualSeconds: null,
          worshipPlannedSeconds: null,
          isMoment: false,
        };
      }
      const isMoment = blockedTrendPtIds.has(pt.id);
      const mid = midByPlanId.get(plan.id) ?? null;
      const msg = messageByPlanId.get(plan.id) ?? null;
      const wsh = worshipByPlanId.get(plan.id) ?? null;
      return {
        serviceDate: plan.service_date,
        plannedSeconds: pt.planned_target_seconds,
        actualSeconds: isMoment ? null : pt.actual_service_seconds,
        midActualSeconds: isMoment ? null : (mid?.actualSeconds ?? null),
        midPlannedSeconds: mid?.plannedSeconds ?? null,
        messageActualSeconds: isMoment ? null : (msg?.actual_seconds ?? null),
        messagePlannedSeconds: msg?.planned_seconds ?? null,
        worshipActualSeconds: isMoment ? null : (wsh?.actual_seconds ?? null),
        worshipPlannedSeconds: wsh?.planned_seconds ?? null,
        isMoment,
      };
    })
    .reverse(); // chronological (oldest first)

  // Cross-campus medians for mid.close_worship over the last 6 service dates
  const allCampuses = await listInstrumentCampuses();
  const allCampusMedians: CrossCampusMedian[] = await Promise.all(
    allCampuses.map(async (c) => {
      const recentPlans = await readRows<{ id: number }>("plans", {
        campus_id: `eq.${c.id}`,
        select: "id",
        order: "service_date.desc",
        limit: "6",
      });
      const actuals = await Promise.all(
        recentPlans.map((p) =>
          readRows<{ actual_seconds: number | null }>("element_variance", {
            plan_id: `eq.${p.id}`,
            element_key: `eq.mid.close_worship`,
            select: "actual_seconds",
          }).then((rows) => rows[0]?.actual_seconds ?? null),
        ),
      );
      return {
        campusCode: c.code,
        medianSeconds: median(actuals),
        isActive: c.code === campus.code,
      };
    }),
  );

  return {
    campus: { code: campus.code, name: campus.name },
    serviceDate: latestPlan.service_date,
    planId: latestPlan.id,
    slot: slotSummary,
    phases: buildPhaseBreakdown(elements),
    elements: elementRows,
    trend: trendPoints,
    allCampusMedians,
    referenceTargetSeconds: campus.reference_target_seconds,
    availableSlots: allSlots.map((s) => ({
      id: s.id,
      label: s.slot_label,
      expectedLocalStart: s.expected_local_start,
    })),
  };
}

// ─── getTriageData ────────────────────────────────────────────────────────────

export async function getTriageData(
  campusCode: string,
  serviceDate: string,
): Promise<TriageData | null> {
  const campus = await campusByCode(campusCode);
  if (!campus) return null;

  // Resolve "latest" to the most recent service date for this campus
  let resolvedDate = serviceDate;
  if (serviceDate === "latest") {
    const latest = await latestPlanForCampus(campus.id);
    if (!latest) return null;
    resolvedDate = latest.service_date;
  }

  const plans = await readRows<{ id: number; title: string | null }>("plans", {
    campus_id: `eq.${campus.id}`,
    service_date: `eq.${resolvedDate}`,
    select: "id,title",
    order: "sort_date.desc",
    limit: "1",
  });

  const plan = plans[0];
  if (!plan) return null;

  // Production plan_times only (no rehearsal, no excluded)
  const planTimesRows = await readRows<TriagePlanTimeRow>("effective_plan_times", {
    plan_id: `eq.${plan.id}`,
    is_manually_excluded: "eq.false",
    effective_slot_id: "not.is.null",
    time_type: "eq.service",
    select: "id,effective_slot_id,pco_name,starts_at,planned_target_seconds,actual_service_seconds",
    order: "starts_at.asc",
  });

  const planTimeIds = planTimesRows.map(({ id }) => id);

  const [allSlots, triageIncidentsList, items, rawElements] = await Promise.all([
    readRows<ServiceSlotRow>("service_slots", {
      campus_id: `eq.${campus.id}`,
      is_active: "eq.true",
      select: "id,slot_label,expected_local_start,is_active",
      order: "expected_local_start.asc",
    }),
    openTriageIncidents(planTimeIds),
    readRows<TriageItemRow>("items", {
      plan_id: `eq.${plan.id}`,
      select: "id,sequence,raw_title,item_type,service_position,section_key,element_key,planned_seconds,is_rollup_child",
      order: "sequence.asc",
    }),
    readRows<{ key: string; section_key: string; display_name: string }>("elements", {
      is_tracked: "eq.true",
      retired_at: "is.null",
      select: "key,section_key,display_name",
      order: "section_key.asc,sort_order.asc",
    }),
  ]);

  const itemTimes =
    planTimeIds.length > 0
      ? await readRows<TriageItemTimeRow>("item_times", {
          plan_time_id: `in.(${planTimeIds.join(",")})`,
          select: "id,item_id,plan_time_id,actual_seconds",
        })
      : [];

  const slotById = new Map(allSlots.map((s) => [s.id, s]));
  const availableSlotsList = allSlots.map((s) => ({ id: s.id, label: s.slot_label }));

  // item_times lookup: planTimeId → itemId → { id, actualSeconds }
  const itemTimesByPlanTime = new Map<number, Map<number, { id: number; actualSeconds: number | null }>>();
  for (const it of itemTimes) {
    if (!itemTimesByPlanTime.has(it.plan_time_id)) {
      itemTimesByPlanTime.set(it.plan_time_id, new Map());
    }
    itemTimesByPlanTime.get(it.plan_time_id)!.set(it.item_id, {
      id: it.id,
      actualSeconds: it.actual_seconds,
    });
  }

  // incident lookups: planTimeId → incidents, incidentId → item_ids
  const incidentsByPlanTime = new Map<number, TriageIncident[]>();
  const incidentItemIds = new Map<number, Set<number>>();
  for (const inc of triageIncidentsList) {
    if (!incidentsByPlanTime.has(inc.plan_time_id)) {
      incidentsByPlanTime.set(inc.plan_time_id, []);
    }
    incidentsByPlanTime.get(inc.plan_time_id)!.push(inc);
    incidentItemIds.set(
      inc.id,
      new Set(inc.review_incident_items.map((rii) => rii.item_id)),
    );
  }

  let totalAttentionCount = 0;

  const triageSlots: TriageSlot[] = planTimesRows.map((pt) => {
    const slot = slotById.get(pt.effective_slot_id);
    const ptIncidents = incidentsByPlanTime.get(pt.id) ?? [];
    const ptItemTimes = itemTimesByPlanTime.get(pt.id) ?? new Map();

    const slotIncidents: SlotIncident[] = ptIncidents
      .filter((inc) => SLOT_BLOCKING_KINDS.has(inc.kind))
      .map((inc) => ({
        id: inc.id,
        kind: inc.kind,
        planTimeId: pt.id,
        canCorrectPlanTimeActual: inc.kind !== "slot_resolution",
        canResolveSlotResolution: inc.kind === "slot_resolution",
        rawActualSeconds: pt.actual_service_seconds,
        plannedSeconds: pt.planned_target_seconds,
        availableSlots: availableSlotsList,
      }));

    // item-level incidents: non-slot-blocking, keyed by item_id
    const itemIncidentByItemId = new Map<number, TriageIncident>();
    for (const inc of ptIncidents) {
      if (!SLOT_BLOCKING_KINDS.has(inc.kind)) {
        const itemIds = incidentItemIds.get(inc.id) ?? new Set();
        for (const itemId of itemIds) {
          itemIncidentByItemId.set(itemId, inc);
        }
      }
    }

    const triageItems: TriageItem[] = items.map((item) => {
      const itemTime = ptItemTimes.get(item.id);
      const incidentForItem = itemIncidentByItemId.get(item.id);

      let status: TriageItemStatus;
      let incident: TriageItemIncident | null = null;

      if (item.item_type === "header") {
        // PCO section headers (PRAISE & WORSHIP, MID SERVICE, LIVE TIME, …) are
        // structural markers, not timed content. The section label already renders
        // them; they must never surface as unmapped/rollup work.
        status = "not_tracked";
      } else if (
        item.service_position === "pre" ||
        item.service_position === "post" ||
        item.section_key === "pre_service" ||
        item.section_key === "post_service"
      ) {
        status = "not_tracked";
      } else if (incidentForItem) {
        status = "incident";
        const rii = incidentForItem.review_incident_items.find(
          (r) => r.item_id === item.id,
        );
        incident = {
          id: incidentForItem.id,
          kind: incidentForItem.kind,
          canCorrectPlanTimeActual: false,
          canCorrectItemTimes: true,
          itemTimeId: rii?.item_time_id ?? itemTime?.id ?? null,
          rawActualSeconds: itemTime?.actualSeconds ?? null,
          plannedSeconds: item.planned_seconds,
        };
      } else if (item.item_type === "song" && item.element_key === null) {
        // Individual worship songs sit at 0:00 inside a tracked worship bundle
        // (worship.open / local.worship_response). The bundle holds the time;
        // the songs are listed only for visibility and roll up automatically.
        // They're already excluded from element_variance (null element_key), so
        // this is purely presentational — never flag them as work.
        status = "rolled_up";
      } else if (item.element_key === null) {
        status = "unmapped";
      } else {
        status = "good";
      }

      if (status === "unmapped" || status === "incident") {
        totalAttentionCount++;
      }

      return {
        id: item.id,
        sequence: item.sequence,
        rawTitle: item.raw_title,
        itemType: item.item_type as "song" | "header" | "media" | "item",
        servicePosition: item.service_position as "pre" | "during" | "post" | null,
        sectionKey: item.section_key,
        elementKey: item.element_key,
        plannedSeconds: item.planned_seconds,
        actualSeconds: itemTime?.actualSeconds ?? null,
        status,
        incident,
      };
    });

    // Group items into sections
    const sectionMap = new Map<string, TriageItem[]>();
    for (const item of triageItems) {
      const key = item.sectionKey ?? "__unsectioned__";
      if (!sectionMap.has(key)) sectionMap.set(key, []);
      sectionMap.get(key)!.push(item);
    }

    const sections: TriageSection[] = [];
    for (const key of SECTION_ORDER) {
      if (sectionMap.has(key)) {
        sections.push({
          sectionKey: key,
          sectionLabel: SECTION_LABELS[key] ?? key.toUpperCase(),
          sectionSortOrder: SECTION_ORDER.indexOf(key),
          items: sectionMap.get(key)!,
        });
      }
    }
    // Any section not in the ordered list
    for (const [key, sectionItems] of sectionMap) {
      if (key !== "__unsectioned__" && !SECTION_ORDER.includes(key)) {
        sections.push({
          sectionKey: key,
          sectionLabel: key.toUpperCase(),
          sectionSortOrder: 99,
          items: sectionItems,
        });
      }
    }
    if (sectionMap.has("__unsectioned__")) {
      sections.push({
        sectionKey: "__unsectioned__",
        sectionLabel: "UNSECTIONED",
        sectionSortOrder: 100,
        items: sectionMap.get("__unsectioned__")!,
      });
    }

    return {
      planTimeId: pt.id,
      slotLabel: slot?.slot_label ?? "Unknown",
      pcoName: pt.pco_name,
      startsAt: pt.starts_at,
      slotIncidents,
      sections,
    };
  });

  const availableElements: AvailableElement[] = rawElements.map((e) => ({
    key: e.key,
    sectionKey: e.section_key,
    displayName: e.display_name,
  }));

  return {
    campus: { code: campus.code, name: campus.name },
    serviceDate: resolvedDate,
    planTitle: plan.title ?? `Service ${resolvedDate}`,
    slots: triageSlots,
    totalAttentionCount,
    availableElements,
  };
}

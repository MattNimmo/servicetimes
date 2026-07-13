import "server-only";

import { readRows } from "@/lib/supabase/rest";
import { isElementBlocked, isSlotBlocked, listServiceDates, type ReviewIncident } from "@/lib/variance/queries";

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
  broadcastIsMessageBlock: boolean;
  isBlocked: boolean;
  phases: PhaseBreakdown;
};

export type GlancePatternWindowStats = {
  weeksWithData: number;
  weeksOver: number;
  avgDeltaSeconds: number | null;
};

export type GlanceElementPattern = {
  elementKey: string;
  elementName: string;
  window6: GlancePatternWindowStats;
  window12: GlancePatternWindowStats;
};

export type GlanceCampus = {
  code: CampusCode;
  name: string;
  referenceTargetSeconds: number;
  isReferenceTargetApproved: boolean;
  serviceDate: string;
  planId: number;
  slots: ServiceSlotSummary[];
  openIncidentCount: number;
  unmappedCount: number;
  elementPatterns: GlanceElementPattern[];
};

type CampusRow = {
  id: number;
  code: CampusCode;
  name: string;
  reference_target_seconds: number;
  reference_target_status: "provisional" | "approved";
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
  effective_slot_id: number;
  section_key: string;
  planned_seconds: number;
  actual_seconds: number | null;
};

type ActivePlanTimeCorrection = {
  plan_time_id: number;
  corrected_actual_seconds: number | null;
};

// ECC's standard campus order: Spring Lake Park (broadcast), Elk River,
// Lakeville, Maple Grove. Keep every campus list in this order.
const CAMPUS_ORDER: CampusCode[] = ["SLP", "ELK", "LV", "MG"];
const PHASE_KEYS: PhaseKey[] = ["worship_open", "mid_service", "live", "local"];

function campusSortIndex(code: CampusCode) {
  const index = CAMPUS_ORDER.indexOf(code);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function resolveMidComparisonSlotLabel(
  activeCampusCode: CampusCode,
  activeSlotLabel: string,
  comparisonCampusCode: CampusCode,
) {
  const isFirstServiceComparison =
    activeSlotLabel === "9am" ||
    (activeCampusCode === "LV" && activeSlotLabel === "10am");

  if (!isFirstServiceComparison) return activeSlotLabel;
  return comparisonCampusCode === "LV" ? "10am" : "9am";
}

function sumNullable(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (numbers.length === 0) return null;
  return numbers.reduce((total, value) => total + value, 0);
}

async function listInstrumentCampuses() {
  const campuses = await readRows<CampusRow>("campuses", {
    select: "id,code,name,reference_target_seconds,reference_target_status",
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

// Element must be at least this far over plan in a week to count toward a
// windowed pattern (matches the plan-change recommendation threshold).
const PATTERN_OVER_THRESHOLD_SECONDS = 30;

function windowStats(
  deltasByRecency: Array<number | null>,
  window: number,
): GlancePatternWindowStats {
  const deltas = deltasByRecency
    .slice(0, window)
    .filter((d): d is number => d !== null);
  return {
    weeksWithData: deltas.length,
    weeksOver: deltas.filter((d) => d >= PATTERN_OVER_THRESHOLD_SECONDS).length,
    avgDeltaSeconds:
      deltas.length > 0
        ? Math.round(deltas.reduce((t, d) => t + d, 0) / deltas.length)
        : null,
  };
}

async function buildCampusGlance(campus: CampusRow): Promise<GlanceCampus | null> {
  // Latest 12 Sundays: [0] powers the card itself, the full list powers the
  // 6/12-week pattern window.
  const recentPlans = await readRows<PlanRow>("plans", {
    campus_id: `eq.${campus.id}`,
    select: "id,campus_id,service_date",
    order: "service_date.desc,sort_date.desc",
    limit: "12",
  });
  const plan = recentPlans[0] ?? null;
  if (!plan) return null;

  const [planTimes, everyPlanTime, slots, elements, unmapped, windowedElements] = await Promise.all([
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
      select: "effective_slot_id,section_key,planned_seconds,actual_seconds",
    }),
    unmappedCount(campus.code, plan.service_date),
    readRows<{
      plan_id: number;
      element_key: string;
      element_name: string;
      planned_seconds: number;
      actual_seconds: number | null;
      actual_is_complete: boolean;
    }>("element_variance", {
      plan_id: `in.(${recentPlans.map(({ id }) => id).join(",")})`,
      select: "plan_id,element_key,element_name,planned_seconds,actual_seconds,actual_is_complete",
    }),
  ]);

  const [incidents, corrections] = await Promise.all([
    openIncidents(plan.id, everyPlanTime.map(({ id }) => id)),
    activePlanTimeCorrections(planTimes.map(({ id }) => id)),
  ]);

  const correctionByPlanTimeId = new Map(
    corrections.map((correction) => [correction.plan_time_id, correction]),
  );
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  // Group element-variance rows by slot so each service time gets its own phase
  // breakdown, rather than summing 9am + 11am into a single campus-wide total.
  const elementsBySlot = new Map<number, ElementVarianceRow[]>();
  for (const row of elements) {
    const existing = elementsBySlot.get(row.effective_slot_id);
    if (existing) existing.push(row);
    else elementsBySlot.set(row.effective_slot_id, [row]);
  }

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
        broadcastIsMessageBlock: false,
        isBlocked: isSlotBlocked(incidents, planTime.id, slot.id),
        phases: buildPhaseBreakdown(elementsBySlot.get(slot.id) ?? []),
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
      broadcastIsMessageBlock: summary.broadcastIsMessageBlock,
      isBlocked: summary.isBlocked,
      phases: summary.phases,
    }));

  // ── Windowed element patterns (6/12wk) ──────────────────────────────────
  // Per element, one delta per Sunday (summed across slots; only weeks where
  // every slot's actual landed count as data), ordered most-recent first.
  const planRecency = new Map(recentPlans.map((p, idx) => [p.id, idx]));
  type WeekAgg = { planned: number; actual: number; complete: boolean };
  const perElement = new Map<
    string,
    { elementName: string; weeks: Map<number, WeekAgg> }
  >();
  for (const row of windowedElements) {
    const recency = planRecency.get(row.plan_id);
    if (recency === undefined) continue;
    if (!perElement.has(row.element_key)) {
      perElement.set(row.element_key, { elementName: row.element_name, weeks: new Map() });
    }
    const weeks = perElement.get(row.element_key)!.weeks;
    const agg = weeks.get(recency) ?? { planned: 0, actual: 0, complete: true };
    agg.planned += row.planned_seconds;
    if (row.actual_seconds === null || !row.actual_is_complete) {
      agg.complete = false;
    } else {
      agg.actual += row.actual_seconds;
    }
    weeks.set(recency, agg);
  }

  const elementPatterns: GlanceElementPattern[] = [...perElement.entries()]
    .map(([elementKey, { elementName, weeks }]) => {
      const deltasByRecency = recentPlans.map((_, idx) => {
        const agg = weeks.get(idx);
        return agg && agg.complete ? agg.actual - agg.planned : null;
      });
      return {
        elementKey,
        elementName,
        window6: windowStats(deltasByRecency, 6),
        window12: windowStats(deltasByRecency, 12),
      };
    })
    .filter((p) => p.window12.weeksWithData > 0);

  return {
    code: campus.code,
    name: campus.name,
    referenceTargetSeconds: campus.reference_target_seconds,
    isReferenceTargetApproved: campus.reference_target_status === "approved",
    serviceDate: plan.service_date,
    planId: plan.id,
    slots: summaries,
    openIncidentCount: incidents.length,
    unmappedCount: unmapped,
    elementPatterns,
  };
}

// ── Broadcast window trend (location-agnostic; broadcast-origin campus) ─────

export type BroadcastTrendPoint = {
  serviceDate: string;
  slotLabel: string;
  windowSeconds: number;
  startsAt: string;
  endsAt: string;
  // true when derived from bumper-end → message-end item timers; false when
  // it fell back to the PlanTime's raw live bounds.
  isMessageBlock: boolean;
};

/**
 * The broadcast window (bumper end → message end, falling back to the raw
 * live bounds) for every production service at the broadcast-origin campus
 * over the last 52 Sundays, oldest first.
 */
export async function getBroadcastWindowTrend(): Promise<BroadcastTrendPoint[]> {
  const origin = (
    await readRows<CampusRow & { is_broadcast_origin: boolean }>("campuses", {
      is_broadcast_origin: "eq.true",
      select: "id,code,name,reference_target_seconds,reference_target_status",
      limit: "1",
    })
  )[0];
  if (!origin) return [];

  const plans = await readRows<PlanRow>("plans", {
    campus_id: `eq.${origin.id}`,
    select: "id,campus_id,service_date",
    order: "service_date.desc,sort_date.desc",
    limit: "52",
  });
  if (plans.length === 0) return [];
  const planIds = plans.map(({ id }) => id);
  const serviceDateByPlanId = new Map(plans.map((p) => [p.id, p.service_date]));

  const [planTimes, slots, windowItems] = await Promise.all([
    readRows<{
      id: number;
      plan_id: number;
      effective_slot_id: number;
      live_starts_at: string | null;
      live_ends_at: string | null;
    }>("effective_plan_times", {
      plan_id: `in.(${planIds.join(",")})`,
      effective_slot_id: "not.is.null",
      time_type: "eq.service",
      is_manually_excluded: "eq.false",
      select: "id,plan_id,effective_slot_id,live_starts_at,live_ends_at",
    }),
    readRows<ServiceSlotRow>("service_slots", {
      campus_id: `eq.${origin.id}`,
      select: "id,slot_label,expected_local_start,is_active",
    }),
    readRows<{ id: number; plan_id: number; element_key: string }>("items", {
      plan_id: `in.(${planIds.join(",")})`,
      element_key: "in.(live.bumper,live.message)",
      select: "id,plan_id,element_key",
    }),
  ]);

  const slotLabelById = new Map(slots.map((s) => [s.id, s.slot_label]));
  const itemById = new Map(windowItems.map((i) => [i.id, i]));

  const itemTimes =
    windowItems.length > 0 && planTimes.length > 0
      ? await readRows<{ item_id: number; plan_time_id: number; live_end_at: string | null }>(
          "item_times",
          {
            item_id: `in.(${windowItems.map(({ id }) => id).join(",")})`,
            plan_time_id: `in.(${planTimes.map(({ id }) => id).join(",")})`,
            select: "item_id,plan_time_id,live_end_at",
          },
        )
      : [];

  // plan_time → latest live_end_at per element
  const endsByPlanTime = new Map<number, { bumper: string | null; message: string | null }>();
  for (const it of itemTimes) {
    if (!it.live_end_at) continue;
    const element = itemById.get(it.item_id)?.element_key;
    if (!element) continue;
    const entry = endsByPlanTime.get(it.plan_time_id) ?? { bumper: null, message: null };
    if (element === "live.bumper") {
      if (!entry.bumper || it.live_end_at > entry.bumper) entry.bumper = it.live_end_at;
    } else if (!entry.message || it.live_end_at > entry.message) {
      entry.message = it.live_end_at;
    }
    endsByPlanTime.set(it.plan_time_id, entry);
  }

  const points: BroadcastTrendPoint[] = [];
  for (const pt of planTimes) {
    const ends = endsByPlanTime.get(pt.id);
    const startsAt = ends?.bumper ?? pt.live_starts_at;
    const endsAt = ends?.message ?? pt.live_ends_at;
    if (!startsAt || !endsAt) continue;
    const windowSeconds = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 1000);
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) continue;
    points.push({
      serviceDate: serviceDateByPlanId.get(pt.plan_id) ?? "",
      slotLabel: slotLabelById.get(pt.effective_slot_id) ?? "?",
      windowSeconds,
      startsAt,
      endsAt,
      isMessageBlock: Boolean(ends?.bumper && ends?.message),
    });
  }

  return points.sort(
    (a, b) =>
      a.serviceDate.localeCompare(b.serviceDate) || a.slotLabel.localeCompare(b.slotLabel),
  );
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

export type MidCampusComparison = {
  campusCode: CampusCode;
  actualSeconds: number | null;
  plannedSeconds: number | null;
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
  midCampusComparison: MidCampusComparison[];
  referenceTargetSeconds: number;
  isReferenceTargetApproved: boolean;
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
  // Wall-clock PCO timer record for this item in the selected slot.
  liveStartAt: string | null;
  liveEndAt: string | null;
  status: TriageItemStatus;
  incident: TriageItemIncident | null;
  resolvedIncidentId: number | null;
  resolutionLabel: string | null;
  hasOverride: boolean;
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
  // Scheduled local start of the production slot ("09:00:00") — anchors the
  // PLAN clock column in Triage.
  expectedLocalStart: string | null;
  slotIncidents: SlotIncident[];
  sections: TriageSection[];
};

export type AvailableElement = {
  key: string;
  sectionKey: string;
  sectionLabel: string;
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

export type ServiceDateOption = {
  serviceDate: string;
  title: string | null;
  slotCount: number;
  attentionCount: number;
};

export async function listInstrumentServiceDates(code: string): Promise<ServiceDateOption[]> {
  const result = await listServiceDates(code);
  if (!result) return [];
  // A service date can carry more than one plan (e.g. a rehearsal plan and the
  // production plan). Triage resolves exactly one plan per date — the latest by
  // sort_date — so the date picker must key by date too, not by plan, or the
  // same Sunday appears twice and its counts describe a plan Triage will never
  // render. listServiceDates is ordered service_date.desc, sort_date.desc, so
  // the first row per date is the plan Triage will pick; keep only that one.
  const seen = new Set<string>();
  return result.dates
    .filter((d) => {
      if (seen.has(d.service_date)) return false;
      seen.add(d.service_date);
      return true;
    })
    .map((d) => ({
      serviceDate: d.service_date,
      title: d.title ?? null,
      slotCount: d.slotCount,
      attentionCount: d.openIncidentCount + d.unmappedCount,
    }));
}

// ─── Private helpers ─────────────────────────────────────────────────────────

async function campusByCode(code: string): Promise<CampusRow | null> {
  const rows = await readRows<CampusRow>("campuses", {
    code: `eq.${code.toUpperCase()}`,
    select: "id,code,name,reference_target_seconds,reference_target_status",
    limit: "1",
  });
  return rows[0] ?? null;
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

type ResolvedTriageIncident = {
  id: number;
  plan_time_id: number;
  status: string;
  review_incident_items: Array<{ item_id: number }>;
};

async function resolvedTriageIncidents(planTimeIds: number[]): Promise<ResolvedTriageIncident[]> {
  if (planTimeIds.length === 0) return [];
  return readRows<ResolvedTriageIncident>("review_incidents", {
    status: "in.(kept,excluded,corrected)",
    plan_time_id: `in.(${planTimeIds.join(",")})`,
    select: "id,plan_time_id,status,review_incident_items(item_id)",
  });
}

async function activeItemOverrides(itemIds: number[]): Promise<Set<number>> {
  if (itemIds.length === 0) return new Set();
  const rows = await readRows<{ item_id: number }>("item_bucket_overrides", {
    item_id: `in.(${itemIds.join(",")})`,
    revoked_at: "is.null",
    select: "item_id",
  });
  return new Set(rows.map((r) => r.item_id));
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
  live_start_at: string | null;
  live_end_at: string | null;
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

async function getMidCampusComparison(
  serviceDate: string,
  slotLabel: string,
  activeCampusCode: CampusCode,
): Promise<MidCampusComparison[]> {
  const campuses = await listInstrumentCampuses();
  if (campuses.length === 0) return [];

  const campusIds = campuses.map((campus) => campus.id);
  const [slots, plans] = await Promise.all([
    readRows<{ id: number; campus_id: number; slot_label: string }>("service_slots", {
      campus_id: `in.(${campusIds.join(",")})`,
      is_active: "eq.true",
      select: "id,campus_id,slot_label",
    }),
    readRows<{ id: number; campus_id: number }>("plans", {
      campus_id: `in.(${campusIds.join(",")})`,
      service_date: `eq.${serviceDate}`,
      select: "id,campus_id",
      order: "sort_date.desc",
    }),
  ]);

  const slotByCampusId = new Map<
    number,
    { id: number; campus_id: number; slot_label: string }
  >();
  for (const campus of campuses) {
    const comparisonSlotLabel = resolveMidComparisonSlotLabel(
      activeCampusCode,
      slotLabel,
      campus.code,
    );
    const slot = slots.find(
      (candidate) =>
        candidate.campus_id === campus.id &&
        candidate.slot_label === comparisonSlotLabel,
    );
    if (slot) slotByCampusId.set(campus.id, slot);
  }
  const planByCampusId = new Map<number, { id: number; campus_id: number }>();
  for (const plan of plans) {
    if (!planByCampusId.has(plan.campus_id)) planByCampusId.set(plan.campus_id, plan);
  }

  const planIds = [...planByCampusId.values()].map((plan) => plan.id);
  const slotIds = [...slotByCampusId.values()].map((slot) => slot.id);
  const midRows =
    planIds.length > 0 && slotIds.length > 0
      ? await readRows<{ plan_id: number; planned_seconds: number; actual_seconds: number | null }>(
          "element_variance",
          {
            plan_id: `in.(${planIds.join(",")})`,
            effective_slot_id: `in.(${slotIds.join(",")})`,
            section_key: "eq.mid_service",
            select: "plan_id,planned_seconds,actual_seconds",
          },
        )
      : [];

  const rowsByPlanId = new Map<
    number,
    Array<{ planned_seconds: number; actual_seconds: number | null }>
  >();
  for (const row of midRows) {
    const rows = rowsByPlanId.get(row.plan_id) ?? [];
    rows.push(row);
    rowsByPlanId.set(row.plan_id, rows);
  }

  return campuses.map((campus) => {
    const plan = planByCampusId.get(campus.id);
    const slot = slotByCampusId.get(campus.id);
    const rows = plan && slot ? (rowsByPlanId.get(plan.id) ?? []) : [];
    return {
      campusCode: campus.code,
      actualSeconds: sumNullable(rows.map((row) => row.actual_seconds)),
      plannedSeconds:
        rows.length > 0
          ? rows.reduce((total, row) => total + row.planned_seconds, 0)
          : null,
      isActive: campus.code === activeCampusCode,
    };
  });
}

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

  const [elements, planTimesForSlot, allIds, midCampusComparison] = await Promise.all([
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
    getMidCampusComparison(latestPlan.service_date, slot.slot_label, campus.code),
  ]);

  const latestPlanTime = planTimesForSlot[0] ?? null;

  const [incidents, corrections, slotItemTimes] = await Promise.all([
    openIncidents(latestPlan.id, allIds.map(({ id }) => id)),
    activePlanTimeCorrections(planTimesForSlot.map(({ id }) => id)),
    latestPlanTime
      ? readRows<{ id: number; item_id: number; live_start_at: string | null; live_end_at: string | null }>("item_times", {
          plan_time_id: `eq.${latestPlanTime.id}`,
          select: "id,item_id,live_start_at,live_end_at",
        })
      : Promise.resolve([] as Array<{ id: number; item_id: number; live_start_at: string | null; live_end_at: string | null }>),
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
  const itemTimesByItemId = new Map(slotItemTimes.map((itemTime) => [itemTime.item_id, itemTime]));
  const elementItemIds = (elementKey: string) =>
    elements.find((element) => element.element_key === elementKey)?.item_ids ?? [];
  // The window boundary is when the element block finishes, so take the
  // latest recorded live end across the element's items (item_ids are in
  // sequence order; usually a single item).
  const lastElementItemEnd = (elementKey: string) => {
    let lastEnd: string | null = null;
    for (const itemId of elementItemIds(elementKey)) {
      const liveEndAt = itemTimesByItemId.get(itemId)?.live_end_at;
      if (liveEndAt && (lastEnd === null || liveEndAt > lastEnd)) {
        lastEnd = liveEndAt;
      }
    }
    return lastEnd;
  };
  const bumperEndAt = lastElementItemEnd("live.bumper");
  const messageEndAt = lastElementItemEnd("live.message");

  const slotSummary: ServiceSlotSummary = {
    slotId: slot.id,
    slotLabel: slot.slot_label,
    planTimeId: latestPlanTime?.id ?? 0,
    plannedSeconds: latestPlanTime?.planned_target_seconds ?? null,
    actualSeconds: actualSecondsForSlot,
    broadcastStartsAt: bumperEndAt ?? latestPlanTime?.live_starts_at ?? null,
    broadcastEndsAt: messageEndAt ?? latestPlanTime?.live_ends_at ?? null,
    broadcastIsMessageBlock: bumperEndAt !== null && messageEndAt !== null,
    isBlocked: latestPlanTime
      ? isSlotBlocked(incidents, latestPlanTime.id, slot.id)
      : false,
    phases: buildPhaseBreakdown(elements),
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

  return {
    campus: { code: campus.code, name: campus.name },
    serviceDate: latestPlan.service_date,
    planId: latestPlan.id,
    slot: slotSummary,
    phases: buildPhaseBreakdown(elements),
    elements: elementRows,
    trend: trendPoints,
    midCampusComparison,
    referenceTargetSeconds: campus.reference_target_seconds,
    isReferenceTargetApproved: campus.reference_target_status === "approved",
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
    readRows<{ key: string; section_key: string; display_name: string; sort_order: number }>("elements", {
      is_tracked: "eq.true",
      retired_at: "is.null",
      select: "key,section_key,display_name,sort_order",
      order: "sort_order.asc",
    }),
  ]);

  const itemIds = items.map((i) => i.id);

  const [itemTimes, resolvedIncidentsList, overriddenItemIds] = await Promise.all([
    planTimeIds.length > 0
      ? readRows<TriageItemTimeRow>("item_times", {
          plan_time_id: `in.(${planTimeIds.join(",")})`,
          select: "id,item_id,plan_time_id,actual_seconds,live_start_at,live_end_at",
        })
      : Promise.resolve([] as TriageItemTimeRow[]),
    resolvedTriageIncidents(planTimeIds),
    activeItemOverrides(itemIds),
  ]);

  const slotById = new Map(allSlots.map((s) => [s.id, s]));
  const availableSlotsList = allSlots.map((s) => ({ id: s.id, label: s.slot_label }));

  // item_times lookup: planTimeId → itemId → { id, actualSeconds, live window }
  const itemTimesByPlanTime = new Map<
    number,
    Map<
      number,
      { id: number; actualSeconds: number | null; liveStartAt: string | null; liveEndAt: string | null }
    >
  >();
  for (const it of itemTimes) {
    if (!itemTimesByPlanTime.has(it.plan_time_id)) {
      itemTimesByPlanTime.set(it.plan_time_id, new Map());
    }
    itemTimesByPlanTime.get(it.plan_time_id)!.set(it.item_id, {
      id: it.id,
      actualSeconds: it.actual_seconds,
      liveStartAt: it.live_start_at,
      liveEndAt: it.live_end_at,
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

  // resolved incident lookup: itemId → first resolved incident for that item
  const resolvedIncidentByItemId = new Map<number, ResolvedTriageIncident>();
  for (const inc of resolvedIncidentsList) {
    for (const rii of inc.review_incident_items) {
      if (!resolvedIncidentByItemId.has(rii.item_id)) {
        resolvedIncidentByItemId.set(rii.item_id, inc);
      }
    }
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

    // Slot-blocking incidents are real open work surfaced in the table, so
    // they count toward the headline — otherwise the header can claim "all
    // clear" while a slot incident is still blocking the service's numbers.
    totalAttentionCount += slotIncidents.length;

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
      const resolvedForItem = resolvedIncidentByItemId.get(item.id);
      const itemHasOverride = overriddenItemIds.has(item.id);

      let status: TriageItemStatus;
      let incident: TriageItemIncident | null = null;
      let resolvedIncidentId: number | null = null;
      let resolutionLabel: string | null = null;

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
        // Open incidents take priority over resolved ones.
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
      } else if (resolvedForItem) {
        status = "resolved";
        resolvedIncidentId = resolvedForItem.id;
        resolutionLabel = resolvedForItem.status.toUpperCase();
      } else if (item.item_type === "song" && item.element_key === null && !itemHasOverride) {
        // Individual worship songs sit at 0:00 inside a tracked worship bundle
        // (worship.open / local.worship_response). The bundle holds the time;
        // the songs are listed only for visibility and roll up automatically.
        // They're already excluded from element_variance (null element_key), so
        // this is purely presentational — never flag them as work.
        status = "rolled_up";
      } else if (item.element_key === null && !itemHasOverride) {
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
        liveStartAt: itemTime?.liveStartAt ?? null,
        liveEndAt: itemTime?.liveEndAt ?? null,
        status,
        incident,
        resolvedIncidentId,
        resolutionLabel,
        hasOverride: itemHasOverride,
      };
    });

    // Group items into sections
    const sectionMap = new Map<string, TriageItem[]>();
    for (const item of triageItems) {
      // Resolved PCO headers are structural — the section band already renders
      // them, so listing them again as NOT TRACKED rows is pure noise. Keep
      // only headers that failed to resolve (UNSECTIONED), so the operator can
      // see the raw title that needs a section alias.
      if (item.itemType === "header" && item.sectionKey !== null) continue;
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
      expectedLocalStart: slot?.expected_local_start ?? null,
      slotIncidents,
      sections,
    };
  });

  // Order the mapping dropdown by the flow of service: sections in service
  // order, elements by their sort order within each section.
  const sectionRank = (key: string) => {
    const idx = SECTION_ORDER.indexOf(key);
    return idx === -1 ? SECTION_ORDER.length : idx;
  };
  const availableElements: AvailableElement[] = rawElements
    .slice()
    .sort(
      (a, b) =>
        sectionRank(a.section_key) - sectionRank(b.section_key) ||
        a.sort_order - b.sort_order,
    )
    .map((e) => ({
      key: e.key,
      sectionKey: e.section_key,
      sectionLabel: SECTION_LABELS[e.section_key] ?? e.section_key.replace(/_/g, " ").toUpperCase(),
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

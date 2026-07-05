"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";

import type {
  BroadcastTrendPoint,
  GlanceCampus,
  PhaseBreakdown,
  PhaseKey,
  ServiceSlotSummary,
} from "@/lib/instrument/queries";
import { formatDelta, formatDuration, formatServiceDate } from "@/lib/variance/format";
import { ChartTipBox, useChartTip } from "./ChartTooltip";

const CAMPUS_TIME_ZONE = "America/Chicago";

type BroadcastWindowHorizon = "6wk" | "6mo" | "12mo";

const BROADCAST_HORIZONS: Array<{ value: BroadcastWindowHorizon; label: string; sundays: number }> = [
  { value: "6wk", label: "6 wk", sundays: 6 },
  { value: "6mo", label: "6 mo", sundays: 26 },
  { value: "12mo", label: "12 mo", sundays: 52 },
];

function formatClock(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: CAMPUS_TIME_ZONE,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  return `${hour}:${minute}${period.toLowerCase().startsWith("p") ? "p" : "a"}`;
}

/** Wall-clock minutes since midnight (campus-local) for an ISO timestamp. */
function wallClockMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: CAMPUS_TIME_ZONE,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function minutesToClock(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const hour24 = Math.floor(rounded / 60) % 24;
  const minute = rounded % 60;
  const suffix = hour24 >= 12 ? "p" : "a";
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour}:${String(minute).padStart(2, "0")}${suffix}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Short "Jun 28" form for card eyebrows when campus dates diverge. */
function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

const SLOT_COLORS = ["var(--accent)", "var(--phase-mid)", "var(--elk)", "var(--lv)"];

// Round the y-axis to a friendly tick step so the scale reads at a glance.
function niceTicks(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const step = [1, 2, 5, 10, 15, 20, 30, 60].find((s) => span / s <= 5) ?? 60;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max; v += step) ticks.push(v);
  return ticks;
}

// Broadcast-window trend for the broadcast-origin campus. Location-agnostic,
// so it lives outside the per-campus cards.
function BroadcastWindowTrend({ points }: { points: BroadcastTrendPoint[] }) {
  const [horizon, setHorizon] = useState<BroadcastWindowHorizon>("6wk");
  const { wrapperRef, tip, showTip, clear } = useChartTip();
  if (points.length === 0) return null;

  const sundays = BROADCAST_HORIZONS.find((h) => h.value === horizon)?.sundays ?? 6;
  const allDates = [...new Set(points.map((p) => p.serviceDate))].sort();
  const windowDates = new Set(allDates.slice(-sundays));
  const visible = points.filter((p) => windowDates.has(p.serviceDate));

  const slotLabels = [...new Set(visible.map((p) => p.slotLabel))].sort();
  const slotColor = new Map(slotLabels.map((label, i) => [label, SLOT_COLORS[i % SLOT_COLORS.length]]));

  const minutes = visible.map((p) => p.windowSeconds / 60);
  const minMin = Math.floor(Math.min(...minutes) - 2);
  const maxMin = Math.ceil(Math.max(...minutes) + 2);
  const medianSeconds =
    [...visible.map((p) => p.windowSeconds)].sort((a, b) => a - b)[
      Math.floor(visible.length / 2)
    ] ?? null;

  const W = 560;
  const H = 150;
  const padX = 40;
  const padY = 18;
  const chartW = W - padX - 14;
  const chartH = H - 2 * padY;
  const dates = [...windowDates].sort();
  const xFor = (serviceDate: string) => {
    const idx = dates.indexOf(serviceDate);
    return padX + (dates.length === 1 ? chartW / 2 : (idx / (dates.length - 1)) * chartW);
  };
  const yFor = (windowSeconds: number) =>
    padY + chartH - ((windowSeconds / 60 - minMin) / Math.max(1, maxMin - minMin)) * chartH;
  const medianY = medianSeconds !== null ? yFor(medianSeconds) : null;
  const ticks = niceTicks(minMin, maxMin);
  const dotR = dates.length > 30 ? 2.6 : dates.length > 10 ? 3.2 : 4;

  return (
    <section
      className="glass-card"
      style={{ borderRadius: "var(--r-glance)", padding: "1.1rem 1.25rem", marginTop: "1.1rem" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p className="instrument-eyebrow" style={{ margin: 0, fontSize: "var(--type-micro)" }}>
            Broadcast window · {BROADCAST_HORIZONS.find((h) => h.value === horizon)?.label}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "var(--type-caption)", color: "var(--ink-70)" }}>
            Bumper end → message end at the broadcast campus
          </p>
        </div>
        <div className="segment-control__options">
          {BROADCAST_HORIZONS.map((h) => (
            <button
              key={h.value}
              type="button"
              className={horizon === h.value ? "segment-option segment-option--active" : "segment-option"}
              aria-pressed={horizon === h.value}
              onClick={() => setHorizon(h.value)}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapperRef} style={{ position: "relative" }} onPointerLeave={clear}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", width: "100%", maxWidth: 720, height: "auto", marginTop: 4 }}
          role="img"
          aria-label={`Broadcast window trend over ${horizon}`}
        >
          {/* y-axis scale: faint gridline + minute label per tick */}
          {ticks.map((tick) => {
            const y = yFor(tick * 60);
            return (
              <g key={tick}>
                <line x1={padX} y1={y} x2={W - 14} y2={y} stroke="var(--ink-fill-chart)" strokeWidth={1} />
                <text x={2} y={y + 3} fill="var(--ink-70)" fontSize="10" fontWeight={700}>
                  {tick}m
                </text>
              </g>
            );
          })}
          {medianY !== null && (
            <>
              <line
                x1={padX}
                y1={medianY}
                x2={W - 14}
                y2={medianY}
                stroke="var(--accent)"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.7}
              />
              <text
                x={W - 14}
                y={Math.max(11, medianY - 5)}
                textAnchor="end"
                fill="var(--accent)"
                fontSize="10"
                fontWeight={700}
              >
                Median {formatDuration(medianSeconds)}
              </text>
            </>
          )}
          {dates.length > 1 && (
            <>
              <text x={padX} y={H - 2} fill="var(--ink-70)" fontSize="10">
                {formatServiceDate(dates[0])}
              </text>
              <text x={W - 14} y={H - 2} textAnchor="end" fill="var(--ink-70)" fontSize="10">
                {formatServiceDate(dates[dates.length - 1])}
              </text>
            </>
          )}
          {visible.map((p, i) => {
            const cx = xFor(p.serviceDate);
            const cy = yFor(p.windowSeconds);
            const tipLines = [
              `${formatServiceDate(p.serviceDate)} · ${p.slotLabel}`,
              `${formatClock(p.startsAt)} → ${formatClock(p.endsAt)} · ${formatDuration(p.windowSeconds)} live`,
              ...(p.isMessageBlock ? [] : ["full live block — no message timers"]),
            ];
            return (
              <g key={`${p.serviceDate}-${p.slotLabel}-${i}`}>
                {/* generous invisible hit target so hover tooltips are easy */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={Math.max(9, dotR + 6)}
                  fill="transparent"
                  onPointerEnter={(event) => showTip(event, tipLines)}
                />
                <circle cx={cx} cy={cy} r={dotR} fill={slotColor.get(p.slotLabel)} pointerEvents="none" />
              </g>
            );
          })}
        </svg>
        <ChartTipBox tip={tip} />
      </div>

      {/* Per-slot start/end stats over the selected window */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto repeat(3, minmax(0, 1fr))",
          columnGap: 18,
          rowGap: 6,
          alignItems: "baseline",
          marginTop: 10,
          maxWidth: 460,
        }}
      >
        <span />
        {["Median start", "Median end", "Median live"].map((label) => (
          <span
            key={label}
            style={{
              fontSize: "var(--type-micro)",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-70)",
            }}
          >
            {label}
          </span>
        ))}
        {slotLabels.map((label) => {
          const slotPoints = visible.filter((p) => p.slotLabel === label);
          const startMed = median(slotPoints.map((p) => wallClockMinutes(p.startsAt)));
          const endMed = median(slotPoints.map((p) => wallClockMinutes(p.endsAt)));
          const liveMed = median(slotPoints.map((p) => p.windowSeconds));
          const stats = [
            startMed !== null ? minutesToClock(startMed) : "—",
            endMed !== null ? minutesToClock(endMed) : "—",
            liveMed !== null ? formatDuration(liveMed) : "—",
          ];
          return (
            <Fragment key={label}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--ink)",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, background: slotColor.get(label) }} />
                {label}
              </span>
              {stats.map((value, i) => (
                <span key={i} className="tabular" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {value}
                </span>
              ))}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

const EMPTY_PHASES: PhaseBreakdown = {
  worship_open: { plannedSeconds: 0, actualSeconds: null },
  mid_service: { plannedSeconds: 0, actualSeconds: null },
  live: { plannedSeconds: 0, actualSeconds: null },
  local: { plannedSeconds: 0, actualSeconds: null },
};

const PHASE_META: Array<{
  key: PhaseKey;
  label: string;
  className: string;
}> = [
  { key: "worship_open", label: "Worship", className: "phase-chip--worship" },
  { key: "mid_service", label: "Mid", className: "phase-chip--mid" },
  { key: "live", label: "Live", className: "phase-chip--live" },
  { key: "local", label: "Local", className: "phase-chip--local" },
];

function slotOptions(campus: GlanceCampus) {
  return campus.slots.map((slot) => slot.slotLabel);
}

function targetLabel(campus: GlanceCampus) {
  return campus.isReferenceTargetApproved ? "approved target" : "working target";
}

function statusLabel(
  campus: GlanceCampus,
  selectedSlot: ServiceSlotSummary | undefined,
  mode: "actuals" | "awaiting",
) {
  if (mode === "awaiting") return "Awaiting Sunday";
  if (!selectedSlot || selectedSlot.actualSeconds === null) return "Needs review";
  if (selectedSlot.isBlocked) return "Needs review";
  if (selectedSlot.actualSeconds > campus.referenceTargetSeconds) return "Over target";
  return "On target";
}

function statusTone(
  campus: GlanceCampus,
  selectedSlot: ServiceSlotSummary | undefined,
  mode: "actuals" | "awaiting",
) {
  const label = statusLabel(campus, selectedSlot, mode);
  if (label === "Needs review") return "review";
  if (label === "Over target") return "over";
  if (label === "On target") return "under";
  return "neutral";
}

function verdictLabel(campus: GlanceCampus, selectedSlot: ServiceSlotSummary | undefined) {
  if (!selectedSlot) return "No tracked service for this date yet.";
  if (selectedSlot.isBlocked) return "The Tech Team is still verifying this service's numbers.";
  if (selectedSlot.actualSeconds === null) return "Sunday's timing hasn't fully landed yet.";

  const delta = selectedSlot.actualSeconds - campus.referenceTargetSeconds;
  if (delta <= 0) return `Cleared the ${targetLabel(campus)}.`;
  if (delta <= 60) return "Slightly over target — within the normal range.";
  if (campus.openIncidentCount > 0) {
    const n = campus.openIncidentCount;
    return `Over target, and ${n} item${n === 1 ? " is" : "s are"} still being verified.`;
  }
  return "Over target — open Workbench to see which part of the service carried it.";
}

function totalPlannedSeconds(phases: PhaseBreakdown) {
  return Object.values(phases).reduce(
    (total, phase) => total + phase.plannedSeconds,
    0,
  );
}

type GlanceRecommendation = {
  urgency: "high" | "medium" | "low";
  label: string;
  detail: string;
  actionLabel: string;
  actionHref: string;
};

const URGENCY_COLOR: Record<GlanceRecommendation["urgency"], string> = {
  high: "var(--over)",
  medium: "var(--review)",
  low: "var(--ink-70)",
};

// Windowed element trends (the "Trend window" toggle): an element that
// keeps running ≥30s over plan across the selected window becomes a
// Confirmed/Emerging trend recommendation, à la the legacy ecc-times report.
// Vocabulary note: ECC distinguishes a "trend" (persists 3+ weeks) from a
// "moment" (one-week content spike), so these use "trend", not "pattern".
function buildPatternRecommendations(
  campus: GlanceCampus,
  recWindow: 6 | 12,
  workbenchHref: string,
): GlanceRecommendation[] {
  const entries = campus.elementPatterns
    .map((pattern) => ({
      pattern,
      stats: recWindow === 6 ? pattern.window6 : pattern.window12,
    }))
    .filter(({ stats }) => stats.weeksWithData >= 2 && (stats.avgDeltaSeconds ?? 0) > 0)
    .map(({ pattern, stats }) => {
      const ratio = stats.weeksOver / stats.weeksWithData;
      const confirmed = stats.weeksWithData >= 4 && ratio >= 0.6;
      const emerging = !confirmed && stats.weeksOver >= 2 && ratio >= 0.4;
      if (!confirmed && !emerging) return null;
      return { pattern, stats, confirmed, avgDelta: stats.avgDeltaSeconds ?? 0 };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.avgDelta - a.avgDelta)
    .slice(0, 3);

  if (entries.length <= 1) {
    return entries.map(({ pattern, stats, confirmed }) => ({
      urgency: confirmed ? ("medium" as const) : ("low" as const),
      label: `${confirmed ? "Confirmed" : "Emerging"} trend: ${pattern.elementName} avg ${formatDelta(stats.avgDeltaSeconds)} (${recWindow} wk)`,
      detail: `Ran 30s+ over plan in ${stats.weeksOver} of ${stats.weeksWithData} tracked weeks. The plan may be wrong, not the execution — consider updating the planned time.`,
      actionLabel: "Open Workbench →",
      actionHref: workbenchHref,
    }));
  }

  // Several trending elements collapse into one grouped recommendation so a
  // card never repeats the same sentence and CTA three times.
  const confirmedCount = entries.filter(({ confirmed }) => confirmed).length;
  const summary = entries
    .map(({ pattern, stats }) => `${pattern.elementName} avg ${formatDelta(stats.avgDeltaSeconds)}`)
    .join(" · ");
  return [
    {
      urgency: confirmedCount > 0 ? ("medium" as const) : ("low" as const),
      label: `${entries.length} elements trending over plan (${recWindow} wk)`,
      detail: `${summary}. The plan may be wrong, not the execution — consider updating planned times.`,
      actionLabel: "Open Workbench →",
      actionHref: workbenchHref,
    },
  ];
}

function buildRecommendations(
  campus: GlanceCampus,
  selectedSlot: ServiceSlotSummary | undefined,
  mode: "actuals" | "awaiting",
  recWindow: 6 | 12,
  isOperator: boolean,
): GlanceRecommendation[] {
  if (mode === "awaiting") return [];

  const recs: GlanceRecommendation[] = [];
  const triageHref = `/instrument/triage?campus=${campus.code}&date=${campus.serviceDate}`;
  const workbenchHref = `/instrument/workbench?campus=${campus.code}&slot=${selectedSlot?.slotLabel ?? ""}`;
  const isBlocked = selectedSlot?.isBlocked ?? false;

  // Triage is operator-only, so triage-routed housekeeping recommendations
  // only render for operators. Viewers still see the blocked/verifying state
  // through the status pill and verdict line.
  if (isOperator && isBlocked) {
    recs.push({
      urgency: "high",
      label: "This service is blocked — Triage decision needed",
      detail: "A data question is holding back reliable numbers for this service. Open Triage to settle it.",
      actionLabel: "Open Triage →",
      actionHref: triageHref,
    });
  }

  if (isOperator && campus.openIncidentCount > 0) {
    const n = campus.openIncidentCount;
    recs.push({
      urgency: isBlocked ? "high" : "medium",
      label: `${n} item${n === 1 ? "" : "s"} waiting on a Triage decision`,
      detail: "Unresolved items reduce the accuracy of element-level numbers across Workbench and service history.",
      actionLabel: "Open Triage →",
      actionHref: triageHref,
    });
  }

  if (!isBlocked) {
    const midPhase = (selectedSlot?.phases ?? EMPTY_PHASES).mid_service;
    const midActual = midPhase.actualSeconds;
    const midPlanned = midPhase.plannedSeconds;
    if (midActual !== null && midPlanned > 0) {
      const midDelta = midActual - midPlanned;
      if (midDelta > 60) {
        recs.push({
          urgency: "medium",
          label: `Mid-service ran ${formatDelta(midDelta)} over plan`,
          detail: "Close worship, announcements, or hosted moment likely drove the overage. Use Workbench to inspect.",
          actionLabel: "Open Workbench →",
          actionHref: workbenchHref,
        });
      }
    }

    const actual = selectedSlot?.actualSeconds ?? null;
    if (actual !== null) {
      const totalDelta = actual - campus.referenceTargetSeconds;
      if (totalDelta > 120) {
        recs.push({
          urgency: "medium",
          label: `Service ran ${formatDelta(totalDelta)} over the ${targetLabel(campus)}`,
          detail: "Open Workbench to see which part of the service carried the most variance before next week.",
          actionLabel: "Open Workbench →",
          actionHref: workbenchHref,
        });
      }
    }
  }

  if (isOperator && campus.unmappedCount > 0) {
    const n = campus.unmappedCount;
    recs.push({
      urgency: "low",
      label: `${n} item${n === 1 ? "" : "s"} not matched to a tracked element`,
      detail: "Unmatched items leave gaps in element-level tracking. Match them in Triage.",
      actionLabel: "Open Triage →",
      actionHref: triageHref,
    });
  }

  recs.push(...buildPatternRecommendations(campus, recWindow, workbenchHref));

  return recs.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.urgency] - order[b.urgency];
  });
}

// Working-memory cap: a card shows at most this many recommendations up
// front; the rest sit behind an explicit "+N more" toggle.
const VISIBLE_RECS = 3;

function RecommendationsPanel({
  recs,
  recWindow,
}: {
  recs: GlanceRecommendation[];
  recWindow: 6 | 12;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleRecs = showAll ? recs : recs.slice(0, VISIBLE_RECS);
  const hiddenCount = recs.length - visibleRecs.length;

  return (
    <div style={{ marginTop: 14 }}>
      <p
        style={{
          margin: "0 0 6px",
          fontSize: "var(--type-micro)",
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--ink-70)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Recommendations</span>
        <span style={{ fontWeight: 500, letterSpacing: "0.1em" }}>{recWindow}wk window</span>
      </p>

      {recs.length === 0 ? (
        <p
          style={{
            fontSize: 11,
            color: "var(--under)",
            margin: 0,
            fontWeight: 600,
            letterSpacing: "0.06em",
          }}
        >
          ✓ All clear — nothing flagged for this service.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visibleRecs.map((rec, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 10,
                background: "var(--ink-fill-soft)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: "0 0 2px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--ink)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: URGENCY_COLOR[rec.urgency],
                      flexShrink: 0,
                    }}
                  />
                  {rec.label}
                </p>
                <p style={{ margin: 0, fontSize: "var(--type-caption)", color: "var(--ink-70)", lineHeight: 1.4 }}>
                  {rec.detail}
                </p>
              </div>
              <a
                href={rec.actionHref}
                style={{
                  fontSize: "var(--type-micro)",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "var(--accent)",
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  flexShrink: 0,
                  alignSelf: "center",
                }}
              >
                {rec.actionLabel}
              </a>
            </div>
          ))}
          {(hiddenCount > 0 || showAll) && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              aria-expanded={showAll}
              style={{
                alignSelf: "flex-start",
                background: "none",
                border: 0,
                padding: "2px 0",
                fontSize: "var(--type-micro)",
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--ink-70)",
                cursor: "pointer",
              }}
            >
              {showAll ? "Show fewer" : `+${hiddenCount} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function GlanceView({
  campuses,
  broadcastTrend,
  isOperator,
}: {
  campuses: GlanceCampus[];
  broadcastTrend: BroadcastTrendPoint[];
  isOperator: boolean;
}) {
  const [mode, setMode] = useState<"actuals" | "awaiting">("actuals");
  const [recWindow, setRecWindow] = useState<6 | 12>(6);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(campuses.map((campus) => [campus.code, false])),
  );
  const [glanceSvc, setGlanceSvc] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      campuses.map((campus) => [campus.code, slotOptions(campus)[0] ?? ""]),
    ),
  );

  const campusCards = useMemo(
    () =>
      campuses.map((campus) => {
        const selectedLabel = glanceSvc[campus.code];
        const selectedSlot =
          campus.slots.find((slot) => slot.slotLabel === selectedLabel) ?? campus.slots[0];
        const phases = selectedSlot?.phases ?? EMPTY_PHASES;
        const totalPlanned = totalPlannedSeconds(phases);
        const recs = buildRecommendations(campus, selectedSlot, mode, recWindow, isOperator);

        return {
          campus,
          selectedSlot,
          phases,
          totalPlanned,
          expanded: expanded[campus.code] ?? false,
          recs,
          midDelta:
            phases.mid_service.actualSeconds !== null
              ? phases.mid_service.actualSeconds - phases.mid_service.plannedSeconds
              : null,
        };
      }),
    [campuses, expanded, glanceSvc, mode, recWindow, isOperator],
  );

  // When every campus is reporting the same Sunday (the normal case), say the
  // date once in the hero and let each card lead with its campus. Cards only
  // carry their own date when campuses diverge.
  const sharedServiceDate =
    new Set(campuses.map((campus) => campus.serviceDate)).size === 1
      ? campuses[0]?.serviceDate ?? null
      : null;

  return (
    <main className="instrument-page">
      <section className="instrument-hero">
        <div>
          <p className="instrument-eyebrow">
            The Monday Glance
            {sharedServiceDate ? ` · ${formatServiceDate(sharedServiceDate)}` : ""}
          </p>
          <h1 className="instrument-title">Where did each campus land?</h1>
          <p className="instrument-subtitle">
            Every campus against plan from the latest Sunday — and what deserves
            a look before next week.
          </p>
        </div>

        <div className="instrument-controls">
          <div className="segment-control">
            <span className="segment-control__label">View</span>
            <div className="segment-control__options">
              <button
                type="button"
                className={mode === "actuals" ? "segment-option segment-option--active" : "segment-option"}
                aria-pressed={mode === "actuals"}
                onClick={() => setMode("actuals")}
              >
                Sunday actuals
              </button>
              <button
                type="button"
                className={mode === "awaiting" ? "segment-option segment-option--active" : "segment-option"}
                aria-pressed={mode === "awaiting"}
                onClick={() => setMode("awaiting")}
              >
                This week&apos;s plan
              </button>
            </div>
          </div>

          <div className="segment-control">
            <span className="segment-control__label">Trend window</span>
            <div className="segment-control__options">
              {[6, 12].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    recWindow === value
                      ? "segment-option segment-option--active"
                      : "segment-option"
                  }
                  aria-pressed={recWindow === value}
                  onClick={() => setRecWindow(value as 6 | 12)}
                >
                  {value} wk
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="glance-grid">
        {campusCards.map(({ campus, selectedSlot, phases, totalPlanned, expanded: isExpanded, recs, midDelta }) => {
          const selectedActual =
            mode === "awaiting" ? selectedSlot?.plannedSeconds ?? null : selectedSlot?.actualSeconds ?? null;
          const delta =
            selectedActual === null
              ? null
              : selectedActual - campus.referenceTargetSeconds;

          return (
            <article key={campus.code} className="glass-card glance-card">
              <button
                type="button"
                className="glance-card__header"
                aria-expanded={isExpanded}
                onClick={() =>
                  setExpanded((current) => ({
                    ...current,
                    [campus.code]: !(current[campus.code] ?? false),
                  }))
                }
              >
                <div>
                  <div className="glance-card__eyebrow">
                    <span className={`campus-dot campus-dot--${campus.code.toLowerCase()}`} />
                    {sharedServiceDate === null && (
                      <>
                        <span>{formatShortDate(campus.serviceDate)}</span>
                        <span>·</span>
                      </>
                    )}
                    <span>{slotOptions(campus).join(" · ")}</span>
                  </div>
                  <h2 className="glance-card__title">{campus.name}</h2>
                </div>
                <div className="glance-card__header-meta">
                  <span className={`status-pill status-pill--${statusTone(campus, selectedSlot, mode)}`}>
                    {statusLabel(campus, selectedSlot, mode)}
                  </span>
                  <span className="glance-card__chevron">{isExpanded ? "▾" : "▸"}</span>
                </div>
              </button>

              <div className="glance-card__body">
                <div className="glance-card__total-row">
                  <div>
                    <p className="glance-card__label">
                      {selectedSlot?.slotLabel ?? "No slot"} · total · {targetLabel(campus)}
                    </p>
                    <p className="glance-card__total tabular">
                      {formatDuration(selectedActual)}
                    </p>
                  </div>
                  <div className={`glance-card__delta${delta !== null && delta > 0 ? " glance-card__delta--over" : " glance-card__delta--under"}`}>
                    {formatDelta(delta)}
                  </div>
                </div>

                {/* Always render the slot row (even single-slot campuses) so
                    collapsed cards in the same row keep an even height. */}
                {campus.slots.length > 0 ? (
                  <div className="slot-picker">
                    {campus.slots.map((slot) => (
                      <button
                        key={`${campus.code}-${slot.slotLabel}`}
                        type="button"
                        className={
                          glanceSvc[campus.code] === slot.slotLabel
                            ? "slot-picker__option slot-picker__option--active"
                            : "slot-picker__option"
                        }
                        aria-pressed={glanceSvc[campus.code] === slot.slotLabel}
                        onClick={() =>
                          setGlanceSvc((current) => ({
                            ...current,
                            [campus.code]: slot.slotLabel,
                          }))
                        }
                      >
                        {slot.slotLabel}
                      </button>
                    ))}
                  </div>
                ) : null}

                {isExpanded ? (
                  <>
                    <div
                      className="phase-bar"
                      aria-label={`Phase breakdown. ${PHASE_META.map((phase) => `${phase.label}: ${formatDuration(phases[phase.key].actualSeconds)} actual, ${formatDuration(phases[phase.key].plannedSeconds)} planned`).join("; ")}.`}
                    >
                      {PHASE_META.map((phase) => {
                        const amount = phases[phase.key].plannedSeconds;
                        const width = totalPlanned > 0 ? (amount / totalPlanned) * 100 : 0;
                        const label = `${phase.label}: ${formatDuration(phases[phase.key].actualSeconds)} actual, ${formatDuration(phases[phase.key].plannedSeconds)} planned.`;
                        return (
                          <span
                            key={phase.key}
                            className={`phase-bar__segment ${phase.className}`}
                            style={{ width: `${width}%` }}
                            title={label}
                          />
                        );
                      })}
                    </div>

                    <div className="phase-chip-row">
                      {PHASE_META.map((phase) => (
                        <div key={phase.key} className={`phase-chip ${phase.className}`}>
                          <span className="phase-chip__label">
                            <span className="phase-chip__dot" aria-hidden />
                            {phase.label}
                          </span>
                          <strong className="tabular">
                            {formatDuration(phases[phase.key].actualSeconds)}
                          </strong>
                        </div>
                      ))}
                    </div>

                    {/* Mid-service lever */}
                    {mode === "actuals" && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: "10px 14px",
                          borderRadius: 10,
                          background: "rgba(221,138,32,0.08)",
                          border: "1px solid rgba(221,138,32,0.14)",
                        }}
                      >
                        <p
                          style={{
                            margin: "0 0 1px",
                            fontSize: "var(--type-micro)",
                            fontWeight: 700,
                            letterSpacing: "0.2em",
                            textTransform: "uppercase",
                            color: "var(--phase-mid-text)",
                          }}
                        >
                          Mid-service · the lever
                        </p>
                        <p
                          style={{
                            margin: "0 0 6px",
                            fontSize: "var(--type-micro)",
                            color: "var(--phase-mid-text)",
                          }}
                        >
                          the part you actually control
                        </p>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                          <span
                            className="tabular"
                            style={{ fontSize: 26, fontWeight: 700, color: "var(--ink)" }}
                          >
                            {formatDuration(phases.mid_service.actualSeconds)}
                          </span>
                          {midDelta !== null && (
                            <span
                              className="tabular"
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: midDelta > 0 ? "var(--over)" : "var(--under)",
                              }}
                            >
                              {formatDelta(midDelta)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <p className="glance-card__verdict">{verdictLabel(campus, selectedSlot)}</p>

                    <RecommendationsPanel recs={recs} recWindow={recWindow} />

                    <div className="glance-card__footer">
                      {isOperator && (
                        <>
                          <div className="glance-metric">
                            <span>In Triage</span>
                            <strong className="tabular" style={{ color: "var(--review)" }}>
                              {campus.openIncidentCount}
                            </strong>
                          </div>
                          <div className="glance-metric">
                            <span>Unmatched</span>
                            <strong className="tabular" style={{ color: "var(--unmapped)" }}>
                              {campus.unmappedCount}
                            </strong>
                          </div>
                        </>
                      )}
                      <div className="glance-metric">
                        <span>Window</span>
                        <strong>{recWindow} weeks</strong>
                      </div>
                    </div>

                    <div className="glance-card__actions">
                      <Link
                        href={`/instrument/workbench?campus=${campus.code}&slot=${selectedSlot?.slotLabel ?? ""}`}
                        className="glance-link"
                      >
                        Open workbench →
                      </Link>
                      {isOperator && (
                        <Link
                          href={`/instrument/triage?campus=${campus.code}&date=${campus.serviceDate}`}
                          className="glance-link"
                        >
                          Open triage →
                        </Link>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <BroadcastWindowTrend points={broadcastTrend} />
    </main>
  );
}

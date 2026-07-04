"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
  const { tip, setTip, clear } = useChartTip();
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
            Bumper end → message end at the broadcast origin
          </p>
        </div>
        <div className="segment-control__options">
          {BROADCAST_HORIZONS.map((h) => (
            <button
              key={h.value}
              type="button"
              className={horizon === h.value ? "segment-option segment-option--active" : "segment-option"}
              onClick={() => setHorizon(h.value)}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: "relative" }} onPointerLeave={clear}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: 150, marginTop: 4 }}
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
                  onPointerEnter={() =>
                    setTip({ xPct: (cx / W) * 100, yPct: (cy / H) * 100, lines: tipLines })
                  }
                />
                <circle cx={cx} cy={cy} r={dotR} fill={slotColor.get(p.slotLabel)} pointerEvents="none" />
              </g>
            );
          })}
        </svg>
        <ChartTipBox tip={tip} />
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: "var(--type-caption)", color: "var(--ink-70)" }}>
        {slotLabels.map((label) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: slotColor.get(label) }} />
            {label}
          </span>
        ))}
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
  return campus.isReferenceTargetApproved ? "reference target" : "provisional target";
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
  if (!selectedSlot) return "No production slot is mapped yet.";
  if (selectedSlot.isBlocked) return "Operator review is still blocking this slot.";
  if (selectedSlot.actualSeconds === null) return "Broadcast actual has not fully landed yet.";

  const delta = selectedSlot.actualSeconds - campus.referenceTargetSeconds;
  if (delta <= 0) return `Cleared the ${targetLabel(campus)}.`;
  if (delta <= 60) return "Within normal range and only slightly over target.";
  if (campus.openIncidentCount > 0) {
    return `${campus.openIncidentCount} review item${campus.openIncidentCount === 1 ? "" : "s"} should be checked next.`;
  }
  return "Above target — use Workbench to inspect the service flow.";
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

// Windowed element patterns (the "Pattern window" toggle): an element that
// keeps running ≥30s over plan across the selected window becomes a
// Confirmed/Emerging pattern recommendation, à la the legacy ecc-times report.
function buildPatternRecommendations(
  campus: GlanceCampus,
  recWindow: 6 | 12,
  workbenchHref: string,
): GlanceRecommendation[] {
  return campus.elementPatterns
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
      return {
        rec: {
          urgency: confirmed ? ("medium" as const) : ("low" as const),
          label: `${confirmed ? "Confirmed" : "Emerging"} pattern: ${pattern.elementName} avg ${formatDelta(stats.avgDeltaSeconds)} (${recWindow} wk)`,
          detail: `Ran 30s+ over plan in ${stats.weeksOver} of ${stats.weeksWithData} tracked weeks. Consider a planned-item target change.`,
          actionLabel: "Open Workbench →",
          actionHref: workbenchHref,
        },
        avgDelta: stats.avgDeltaSeconds ?? 0,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.avgDelta - a.avgDelta)
    .slice(0, 3)
    .map(({ rec }) => rec);
}

function buildRecommendations(
  campus: GlanceCampus,
  selectedSlot: ServiceSlotSummary | undefined,
  mode: "actuals" | "awaiting",
  recWindow: 6 | 12,
): GlanceRecommendation[] {
  if (mode === "awaiting") return [];

  const recs: GlanceRecommendation[] = [];
  const triageHref = `/instrument/triage?campus=${campus.code}&date=${campus.serviceDate}`;
  const workbenchHref = `/instrument/workbench?campus=${campus.code}&slot=${selectedSlot?.slotLabel ?? ""}`;
  const isBlocked = selectedSlot?.isBlocked ?? false;

  if (isBlocked) {
    recs.push({
      urgency: "high",
      label: "This slot is blocked — operator action required",
      detail: "A review incident is preventing reliable data for this service. Open Triage to resolve it.",
      actionLabel: "Open Triage →",
      actionHref: triageHref,
    });
  }

  if (campus.openIncidentCount > 0) {
    const n = campus.openIncidentCount;
    recs.push({
      urgency: isBlocked ? "high" : "medium",
      label: `${n} open incident${n === 1 ? "" : "s"} need resolution`,
      detail: "Review incidents reduce the accuracy of element-level data across Workbench and variance reports.",
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
          detail: "Use Workbench to identify which phase is carrying the most variance before next week.",
          actionLabel: "Open Workbench →",
          actionHref: workbenchHref,
        });
      }
    }
  }

  if (campus.unmappedCount > 0) {
    const n = campus.unmappedCount;
    recs.push({
      urgency: "low",
      label: `${n} item${n === 1 ? "" : "s"} need taxonomy mapping`,
      detail: "Unmapped items create gaps in element-level variance tracking. Map them in Triage.",
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

function RecommendationsPanel({
  recs,
  recWindow,
}: {
  recs: GlanceRecommendation[];
  recWindow: 6 | 12;
}) {
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
          {recs.map((rec, i) => (
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
                borderLeft: `3px solid ${URGENCY_COLOR[rec.urgency]}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>
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
        </div>
      )}
    </div>
  );
}

export default function GlanceView({
  campuses,
  broadcastTrend,
}: {
  campuses: GlanceCampus[];
  broadcastTrend: BroadcastTrendPoint[];
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
        const recs = buildRecommendations(campus, selectedSlot, mode, recWindow);

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
    [campuses, expanded, glanceSvc, mode, recWindow],
  );

  return (
    <main className="instrument-page">
      <section className="instrument-hero">
        <div>
          <p className="instrument-eyebrow">The Monday Glance</p>
          <h1 className="instrument-title">Where did each campus land?</h1>
          <p className="instrument-subtitle">
            Live service summaries across the latest campus dates, with review
            pressure called out before we go deeper into Workbench or Triage.
          </p>
        </div>

        <div className="instrument-controls">
          <div className="segment-control">
            <span className="segment-control__label">View</span>
            <div className="segment-control__options">
              <button
                type="button"
                className={mode === "actuals" ? "segment-option segment-option--active" : "segment-option"}
                onClick={() => setMode("actuals")}
              >
                Sun actuals
              </button>
              <button
                type="button"
                className={mode === "awaiting" ? "segment-option segment-option--active" : "segment-option"}
                onClick={() => setMode("awaiting")}
              >
                Thu plan
              </button>
            </div>
          </div>

          <div className="segment-control">
            <span className="segment-control__label">Pattern window</span>
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
                    <span>{campus.name}</span>
                    <span>·</span>
                    <span>{slotOptions(campus).join(" · ")}</span>
                  </div>
                  <h2 className="glance-card__title">
                    {formatServiceDate(campus.serviceDate)}
                  </h2>
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
                            color: "var(--phase-mid)",
                          }}
                        >
                          Mid-service · the lever
                        </p>
                        <p
                          style={{
                            margin: "0 0 6px",
                            fontSize: "var(--type-micro)",
                            color: "var(--phase-mid)",
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
                      <div className="glance-metric">
                        <span>Open review</span>
                        <strong className="tabular" style={{ color: "var(--review)" }}>
                          {campus.openIncidentCount}
                        </strong>
                      </div>
                      <div className="glance-metric">
                        <span>Unmapped</span>
                        <strong className="tabular" style={{ color: "var(--unmapped)" }}>
                          {campus.unmappedCount}
                        </strong>
                      </div>
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
                      <Link
                        href={`/instrument/triage?campus=${campus.code}&date=${campus.serviceDate}`}
                        className="glance-link"
                      >
                        Open triage →
                      </Link>
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

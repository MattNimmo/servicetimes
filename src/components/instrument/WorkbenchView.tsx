"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  CrossCampusMedian,
  PhaseKey,
  TrendPoint,
  WorkbenchData,
  WorkbenchElementRow,
  WorkbenchHorizon,
} from "@/lib/instrument/queries";
import { formatDelta, formatDuration, formatServiceDate } from "@/lib/variance/format";
import Toast from "./Toast";

const CAMPUS_CODES = ["SLP", "MG", "ELK", "LV"] as const;

const PHASE_META: Array<{ key: PhaseKey; label: string; color: string }> = [
  { key: "worship_open", label: "Worship", color: "var(--phase-worship)" },
  { key: "mid_service", label: "Mid", color: "var(--phase-mid)" },
  { key: "live", label: "Live", color: "var(--phase-live)" },
  { key: "local", label: "Local", color: "var(--phase-local)" },
];

const HORIZON_OPTIONS: Array<{ label: string; value: WorkbenchHorizon }> = [
  { label: "LAST", value: "last" },
  { label: "6 WK", value: "6wk" },
  { label: "6 MO", value: "6mo" },
  { label: "12 MO", value: "12mo" },
];

type WbMetric = "total" | "mid" | "message" | "worship";

function metricLabel(metric: WbMetric) {
  if (metric === "mid") return "mid-service";
  if (metric === "message") return "message";
  if (metric === "worship") return "worship";
  return "total service";
}

function metricSeconds(pt: TrendPoint, metric: WbMetric) {
  if (metric === "total") {
    return { actual: pt.actualSeconds, planned: pt.plannedSeconds };
  }
  if (metric === "mid") {
    return { actual: pt.midActualSeconds, planned: pt.midPlannedSeconds };
  }
  if (metric === "message") {
    return { actual: pt.messageActualSeconds, planned: pt.messagePlannedSeconds };
  }
  return { actual: pt.worshipActualSeconds, planned: pt.worshipPlannedSeconds };
}

function campusColorVar(code: string) {
  return `var(--${code.toLowerCase()})`;
}

function formatBroadcastTime(isoOrTime: string | null): string | null {
  if (!isoOrTime) return null;
  const d = new Date(isoOrTime);
  if (isNaN(d.getTime())) return null;
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? "p" : "a";
  return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, "0")}${suffix}`;
}

function TrendChart({
  trend,
  metric,
}: {
  trend: TrendPoint[];
  metric: WbMetric;
}) {
  if (trend.length === 0) {
    return (
      <div
        style={{
          height: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p style={{ color: "var(--ink-70)", fontSize: 11, margin: 0 }}>No data</p>
      </div>
    );
  }

  const deltas = trend.map((pt) => {
    const { actual, planned } = metricSeconds(pt, metric);
    return actual !== null && planned !== null ? actual - planned : null;
  });
  const validDeltas = deltas.filter((d): d is number => d !== null);
  const maxAbs = Math.max(600, ...validDeltas.map(Math.abs));

  const W = 560,
    H = 150,
    padX = 40,
    padY = 18;
  const chartW = W - padX - 14;
  const chartH = H - 2 * padY;
  const centerY = padY + chartH / 2;
  // Denser horizons get smaller markers so 52 points stay readable.
  const dotR = trend.length > 30 ? 2.6 : trend.length > 10 ? 3.2 : 4;

  const pts = trend.map((pt, i) => {
    const x =
      padX +
      (trend.length === 1 ? chartW / 2 : (i / (trend.length - 1)) * chartW);
    const delta = deltas[i];
    const y = delta !== null ? centerY - (delta / maxAbs) * (chartH / 2) : null;
    return { x, y, delta, isMoment: pt.isMoment };
  });

  let pathD = "";
  pts.forEach((pt, i) => {
    if (pt.y === null) return;
    const prev = pts[i - 1];
    pathD += prev?.y != null ? ` L ${pt.x} ${pt.y}` : ` M ${pt.x} ${pt.y}`;
  });

  const sorted = [...validDeltas].sort((a, b) => a - b);
  const medianDelta =
    sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
  const medianY =
    medianDelta !== null ? centerY - (medianDelta / maxAbs) * (chartH / 2) : null;
  const minDelta = sorted[0] ?? null;
  const maxDelta = sorted[sorted.length - 1] ?? null;
  const dateRange =
    trend.length > 1
      ? `${formatServiceDate(trend[0].serviceDate)} to ${formatServiceDate(trend[trend.length - 1].serviceDate)}`
      : formatServiceDate(trend[0].serviceDate);
  const summary = `${metricLabel(metric)} trend, ${dateRange}. Minimum ${formatDelta(minDelta)}, median ${formatDelta(medianDelta)}, maximum ${formatDelta(maxDelta)}.`;

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: 150 }}
        role="img"
        aria-label={summary}
      >
      {/* No chart-level <title>: it would swallow the per-point tooltips. */}
      <desc>
        Each point shows actual time compared with planned time. Hollow points
        mark moment services.
      </desc>
      <text x={2} y={padY + 4} fill="var(--ink-70)" fontSize="10" fontWeight={700}>
        {formatDelta(maxAbs)}
      </text>
      <text x={2} y={centerY + 3} fill="var(--ink-70)" fontSize="10" fontWeight={700}>
        0
      </text>
      <text x={2} y={H - padY + 4} fill="var(--ink-70)" fontSize="10" fontWeight={700}>
        {formatDelta(-maxAbs)}
      </text>
      <line
        x1={padX}
        y1={centerY}
        x2={W - 14}
        y2={centerY}
        stroke="var(--ink-line-medium)"
        strokeWidth={1}
      />
      {medianY !== null && (
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
      )}
      {medianY !== null && (
        <text
          x={W - 14}
          y={Math.max(11, medianY - 5)}
          textAnchor="end"
          fill="var(--accent)"
          fontSize="10"
          fontWeight={700}
        >
          Median {formatDelta(medianDelta)}
        </text>
      )}
      {trend.length > 1 && (
        <>
          <text x={padX} y={H - 2} fill="var(--ink-70)" fontSize="10">
            {formatServiceDate(trend[0].serviceDate)}
          </text>
          <text x={W - 14} y={H - 2} textAnchor="end" fill="var(--ink-70)" fontSize="10">
            {formatServiceDate(trend[trend.length - 1].serviceDate)}
          </text>
        </>
      )}
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke="var(--ink-line-strong)"
          strokeWidth={1}
          strokeLinejoin="round"
          opacity={trend.length > 30 ? 0.45 : 0.7}
        />
      )}
      {pts.map((pt, i) => {
        const source = trend[i];
        const { actual, planned } = metricSeconds(source, metric);
        const pointLabel =
          pt.delta === null
            ? `${formatServiceDate(source.serviceDate)}: no ${metricLabel(metric)} actual available`
            : `${formatServiceDate(source.serviceDate)} · ${metricLabel(metric)}: actual ${formatDuration(actual)} vs plan ${formatDuration(planned)} → ${formatDelta(pt.delta)}${pt.isMoment ? " · moment service" : ""}`;
        const cy = pt.y ?? centerY;
        const color =
          pt.delta === null || pt.delta === 0
            ? "var(--ink-70)"
            : pt.delta > 0
              ? "var(--over)"
              : "var(--under)";
        const hollow = pt.isMoment || pt.y === null;
        return (
          <g key={i}>
            {/* generous invisible hit target so every point is hoverable */}
            <circle cx={pt.x} cy={cy} r={Math.max(8, dotR + 5)} fill="transparent">
              <title>{pointLabel}</title>
            </circle>
            {hollow ? (
              <circle
                cx={pt.x}
                cy={cy}
                r={dotR + 0.5}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                pointerEvents="none"
              />
            ) : (
              <circle cx={pt.x} cy={cy} r={dotR} fill={color} pointerEvents="none" />
            )}
          </g>
        );
      })}
      </svg>
      <p className="sr-only">{summary}</p>
    </>
  );
}

function DivergingBar({
  planned,
  actual,
}: {
  planned: number;
  actual: number | null;
}) {
  if (actual === null || planned === 0) {
    return (
      <div
        style={{
          height: 4,
          background: "var(--hairline)",
          borderRadius: 999,
        }}
      />
    );
  }
  const delta = actual - planned;
  const fraction = Math.min(Math.abs(delta) / planned, 1) * 0.48;
  const pct = fraction * 100;
  const isOver = delta > 0;
  const label = `Planned ${formatDuration(planned)}, actual ${formatDuration(actual)}, delta ${formatDelta(delta)}.`;

  return (
    <div
      aria-label={label}
      title={label}
      role="img"
      style={{
        position: "relative",
        height: 4,
        background: "var(--ink-fill-chart)",
        borderRadius: 999,
        overflow: "visible",
      }}
    >
      {/* plan line */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -2,
          width: 1,
          height: 8,
          background: "var(--ink-marker)",
          transform: "translateX(-50%)",
        }}
      />
      {isOver ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: `${pct}%`,
            height: 4,
            background: "var(--over)",
            borderRadius: "0 999px 999px 0",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            right: `${50}%`,
            top: 0,
            width: `${pct}%`,
            height: 4,
            background: "var(--under)",
            borderRadius: "999px 0 0 999px",
          }}
        />
      )}
    </div>
  );
}

function CrossMedianBars({ medians }: { medians: CrossCampusMedian[] }) {
  const max = Math.max(1, ...medians.map((m) => m.medianSeconds ?? 0));
  const summary = medians
    .map((m) => `${m.campusCode}${m.isActive ? " current" : ""}: ${m.medianSeconds !== null ? formatDuration(m.medianSeconds) : "no median"}`)
    .join("; ");
  return (
    <div
      aria-label={`Cross-campus close worship medians. ${summary}`}
      style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}
    >
      {medians.map((m) => {
        const pct = ((m.medianSeconds ?? 0) / max) * 100;
        const color = campusColorVar(m.campusCode);
        const label = `${m.campusCode}${m.isActive ? " current campus" : ""}: ${m.medianSeconds !== null ? formatDuration(m.medianSeconds) : "no median"}.`;
        return (
          <div key={m.campusCode} title={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 28,
                fontSize: "var(--type-micro)",
                fontWeight: m.isActive ? 800 : 700,
                letterSpacing: "0.1em",
                color: m.isActive ? "var(--ink)" : "var(--ink-70)",
                textTransform: "uppercase",
              }}
            >
              {m.campusCode}
            </span>
            <div
              style={{
                flex: 1,
                height: 6,
                borderRadius: 999,
                background: "var(--ink-fill-chart)",
                overflow: "hidden",
                outline: m.isActive ? `2px solid ${color}` : "none",
                outlineOffset: 2,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: m.isActive ? color : "var(--phase-worship)",
                  borderRadius: 999,
                  opacity: m.isActive ? 1 : 0.45,
                  transition: "width 300ms ease",
                }}
              />
            </div>
            <span
              className="tabular"
              style={{
                width: 40,
                fontSize: "var(--type-caption)",
                textAlign: "right",
                color: m.isActive ? "var(--ink)" : "var(--ink-70)",
              }}
            >
              {m.medianSeconds !== null ? formatDuration(m.medianSeconds) : "—"}
            </span>
            {m.isActive && <span className="pill">Current</span>}
          </div>
        );
      })}
    </div>
  );
}

function ElementTable({ elements }: { elements: WorkbenchElementRow[] }) {
  if (elements.length === 0) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--ink-70)", fontSize: 13 }}>
        No element data for this slot.
      </div>
    );
  }

  const sections = Array.from(
    new Map(
      elements.map((e) => [
        e.sectionKey,
        { key: e.sectionKey, name: e.sectionName, sort: e.sectionSortOrder },
      ]),
    ).values(),
  ).sort((a, b) => a.sort - b.sort);

  return (
    <div className="data-table-scroll">
      <table className="data-table wb-element-table">
        <thead>
          <tr>
            <th>Element</th>
            <th className="wb-element-table__allot">Allot</th>
            <th className="wb-element-table__bar">Variance</th>
            <th className="wb-element-table__actual">Actual · Δ</th>
          </tr>
        </thead>
        {sections.map((section) => {
          const sectionElements = elements.filter((e) => e.sectionKey === section.key);
          const sectionPlanned = sectionElements.reduce(
            (t, e) => t + e.plannedSeconds,
            0,
          );
          const sectionActuals = sectionElements
            .map((e) => e.actualSeconds)
            .filter((v): v is number => v !== null);
          const sectionActual =
            sectionActuals.length > 0
              ? sectionActuals.reduce((t, v) => t + v, 0)
              : null;

          return (
            <tbody key={section.key}>
              <tr className="data-table__section">
                <td colSpan={3}>{section.name}</td>
                <td className="data-table__section-summary tabular">
                  {formatDuration(sectionPlanned)} · {formatDuration(sectionActual)}
                </td>
              </tr>
              {sectionElements.map((el) => {
                const delta =
                  el.actualSeconds !== null
                    ? el.actualSeconds - el.plannedSeconds
                    : null;
                const actualColor =
                  delta === null
                    ? "var(--ink-70)"
                    : delta > 0
                      ? "var(--over)"
                      : delta < 0
                        ? "var(--under)"
                        : "var(--ink)";

                return (
                  <tr key={el.elementKey}>
                    <td>
                      <span className="wb-element-table__name">
                        {el.elementName}
                        {el.isHumanAdjusted && <span className="pill">ADJ</span>}
                      </span>
                    </td>
                    <td className="muted tabular">{formatDuration(el.plannedSeconds)}</td>
                    <td>
                      <DivergingBar planned={el.plannedSeconds} actual={el.actualSeconds} />
                    </td>
                    <td className="wb-element-table__actual tabular" style={{ color: actualColor }}>
                      {el.isBlocked ? (
                        <span className="pill pill--review">Needs review</span>
                      ) : (
                        <>
                          {formatDuration(el.actualSeconds)}{" "}
                          {delta !== null && (
                            <span style={{ fontSize: "var(--type-caption)" }}>
                              {formatDelta(delta)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export default function WorkbenchView({
  data,
  campus,
  slot,
  horizon,
}: {
  data: WorkbenchData;
  campus: string;
  slot: string;
  horizon: WorkbenchHorizon;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [wbMetric, setWbMetric] = useState<WbMetric>("total");
  const [toast, setToast] = useState<string | null>(null);
  const redirectTo = `/instrument/workbench?campus=${campus}&slot=${encodeURIComponent(slot)}&horizon=${horizon}`;

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const msg = searchParams.get("toast");
    if (!msg) return;
    const id = setTimeout(() => setToast(msg), 0);
    router.replace(redirectTo);
    return () => clearTimeout(id);
  }, [searchParams, router, redirectTo]);

  function navigate(params: {
    campus?: string;
    slot?: string;
    horizon?: WorkbenchHorizon;
  }) {
    const p = new URLSearchParams({
      campus: params.campus ?? campus,
      slot: params.slot ?? slot,
      horizon: params.horizon ?? horizon,
    });
    router.push(`/instrument/workbench?${p.toString()}`);
  }

  const {
    slot: slotSummary,
    phases,
    trend,
    allCampusMedians,
    referenceTargetSeconds,
    isReferenceTargetApproved,
  } = data;
  const targetLabel = isReferenceTargetApproved ? "REF. TARGET" : "PROV. TARGET";
  const totalPlanned = Object.values(phases).reduce(
    (t, p) => t + p.plannedSeconds,
    0,
  );

  const delta =
    slotSummary.actualSeconds !== null
      ? slotSummary.actualSeconds - referenceTargetSeconds
      : null;

  const broadcastStart = formatBroadcastTime(slotSummary.broadcastStartsAt);
  const broadcastEnd = formatBroadcastTime(slotSummary.broadcastEndsAt);
  const broadcastDurationMin =
    slotSummary.broadcastStartsAt && slotSummary.broadcastEndsAt
      ? Math.round(
          (new Date(slotSummary.broadcastEndsAt).getTime() -
            new Date(slotSummary.broadcastStartsAt).getTime()) /
            60000,
        )
      : null;
  const broadcastCaption = slotSummary.broadcastIsMessageBlock
    ? "BUMPER END → MESSAGE END · the on-air message block"
    : "LIVE → END · full live block (message timers unavailable)";

  const midPhase = phases.mid_service;
  const midDelta =
    midPhase.actualSeconds !== null
      ? midPhase.actualSeconds - midPhase.plannedSeconds
      : null;

  return (
    <main className="instrument-page">
      {/* Header */}
      <section className="instrument-hero">
        <div>
          <p className="instrument-eyebrow">Workbench</p>
          <h1 className="instrument-title" style={{ fontSize: "clamp(1.8rem,3.5vw,3rem)" }}>
            {data.campus.name} · {formatServiceDate(data.serviceDate)}
          </h1>
          <p className="instrument-subtitle" style={{ marginTop: "0.5rem" }}>
            Slot-level service flow with trend context and element drill-in.
          </p>
        </div>

        {/* Horizon toggle */}
        <div className="instrument-controls">
          <div className="segment-control">
            <span className="segment-control__label">Horizon</span>
            <div className="segment-control__options">
              {HORIZON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={
                    horizon === opt.value
                      ? "segment-option segment-option--active"
                      : "segment-option"
                  }
                  onClick={() => navigate({ horizon: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Campus selector */}
      <div className="inline-control-row inline-control-row--spaced">
        {CAMPUS_CODES.map((code) => {
          const active = campus === code;
          const color = campusColorVar(code);
          return (
            <button
              key={code}
              type="button"
              onClick={() => navigate({ campus: code })}
              className={active ? "campus-switch campus-switch--active" : "campus-switch"}
              style={{ "--campus-color": color } as CSSProperties}
            >
              <span className="campus-switch__dot" />
              {code}
            </button>
          );
        })}
      </div>

      {/* Slot + context row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-70)" }}>
          {data.campus.name}
        </span>
        <div className="inline-control-row">
          {data.availableSlots.map((s) => (
            <button
              key={s.id}
              type="button"
              className={
                slot === s.label
                  ? "slot-picker__option slot-picker__option--active"
                  : "slot-picker__option"
              }
              onClick={() => navigate({ slot: s.label })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bento grid */}
      <div className="wb-bento">
        {/* Total tile – span 2 */}
        <div className="glass-card wb-tile wb-tile--span2">
          <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)" }}>
            Total service · {HORIZON_OPTIONS.find((o) => o.value === horizon)?.label}
          </p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 8 }}>
            <p
              className="tabular"
              style={{ margin: 0, fontSize: "clamp(2.2rem,4vw,3rem)", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.05em" }}
            >
              {formatDuration(slotSummary.actualSeconds)}
            </p>
            <p
              className="tabular"
              style={{
                margin: "0 0 4px",
                fontSize: 15,
                fontWeight: 700,
                color: delta === null ? "var(--ink-70)" : delta > 0 ? "var(--over)" : delta < 0 ? "var(--under)" : "var(--ink)",
              }}
            >
              {formatDelta(delta)}
            </p>
          </div>
          <p style={{ margin: "4px 0 12px", fontSize: "var(--type-caption)", color: "var(--ink-70)", letterSpacing: "0.1em" }}>
            VS {targetLabel} · n={trend.length}
          </p>

          {/* Phase bar */}
          <div
            className="phase-bar"
            aria-label={`Phase breakdown. ${PHASE_META.map((ph) => `${ph.label}: ${formatDuration(phases[ph.key].actualSeconds)} actual, ${formatDuration(phases[ph.key].plannedSeconds)} planned`).join("; ")}.`}
          >
            {PHASE_META.map((ph) => {
              const width =
                totalPlanned > 0
                  ? (phases[ph.key].plannedSeconds / totalPlanned) * 100
                  : 0;
              const label = `${ph.label}: ${formatDuration(phases[ph.key].actualSeconds)} actual, ${formatDuration(phases[ph.key].plannedSeconds)} planned.`;
              return (
                <span
                  key={ph.key}
                  className="phase-bar__segment"
                  style={{ width: `${width}%`, background: ph.color }}
                  title={label}
                />
              );
            })}
          </div>

          {/* Phase legend */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 10 }}>
            {PHASE_META.map((ph) => (
              <div key={ph.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "var(--type-micro)", fontWeight: 700, letterSpacing: "0.12em", color: "var(--ink-70)", textTransform: "uppercase" }}>
                  {ph.label}
                </span>
                <span
                  className="tabular"
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: ph.key === "mid_service" ? "var(--phase-mid)" : "var(--ink)",
                  }}
                >
                  {formatDuration(phases[ph.key].actualSeconds)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Broadcast window tile – span 2 */}
        <div className="glass-card wb-tile wb-tile--span2">
          <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)", color: "var(--accent)" }}>
            Broadcast window
          </p>
          {broadcastStart && broadcastEnd ? (
            <>
              <p
                className="tabular"
                style={{ margin: "8px 0 0", fontSize: "clamp(1.4rem,2.5vw,2rem)", fontWeight: 700, letterSpacing: "-0.04em" }}
              >
                {broadcastStart} → {broadcastEnd}
              </p>
              <p style={{ margin: "4px 0 12px", fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>
                {broadcastDurationMin !== null ? `${broadcastDurationMin} MIN LIVE` : ""}
              </p>
            </>
          ) : (
            <p style={{ margin: "8px 0 12px", fontSize: 13, color: "var(--ink-70)" }}>
              No broadcast window recorded yet.
            </p>
          )}

          {/* Mini phase bar highlighting Live */}
          <div
            aria-label={`Broadcast phase breakdown. ${PHASE_META.map((ph) => `${ph.label}: ${formatDuration(phases[ph.key].actualSeconds)} actual, ${formatDuration(phases[ph.key].plannedSeconds)} planned`).join("; ")}.`}
            style={{
              display: "flex",
              height: 6,
              borderRadius: 999,
              overflow: "hidden",
              background: "var(--ink-fill-chart)",
            }}
          >
            {PHASE_META.map((ph) => {
              const width =
                totalPlanned > 0
                  ? (phases[ph.key].plannedSeconds / totalPlanned) * 100
                  : 0;
              const label = `${ph.label}: ${formatDuration(phases[ph.key].actualSeconds)} actual, ${formatDuration(phases[ph.key].plannedSeconds)} planned.`;
              return (
                <div
                  key={ph.key}
                  title={label}
                  style={{
                    width: `${width}%`,
                    background: ph.key === "live" ? "var(--accent)" : "var(--ink-fill-medium)",
                  }}
                />
              );
            })}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "var(--type-caption)", color: "var(--ink-70)", letterSpacing: "0.08em" }}>
            {broadcastCaption}
          </p>
        </div>

        {/* Mid lever tile */}
        <div
          className="glass-card wb-tile"
          style={{
            background: "rgba(221,138,32,0.08)",
          }}
        >
          <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)", color: "var(--phase-mid)" }}>
            Mid · the lever
          </p>
          <p
            className="tabular"
            style={{ margin: "8px 0 0", fontSize: "clamp(1.6rem,2.8vw,2.2rem)", fontWeight: 700, letterSpacing: "-0.05em", color: "var(--phase-mid)" }}
          >
            {formatDuration(midPhase.actualSeconds)}
          </p>
          <p
            className="tabular"
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              fontWeight: 700,
              color: midDelta === null ? "var(--ink-70)" : midDelta > 0 ? "var(--over)" : "var(--under)",
            }}
          >
            {formatDelta(midDelta)}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: "var(--type-caption)", color: "var(--phase-mid)", letterSpacing: "0.08em" }}>
            THE PART YOU ACTUALLY CONTROL
          </p>
        </div>

        {/* Cross tile */}
        <div className="glass-card wb-tile">
          <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)" }}>
            Cross · close worship
          </p>
          <CrossMedianBars medians={allCampusMedians} />
        </div>

        {/* Trend tile – span 2 */}
        <div className="glass-card wb-tile wb-tile--span2">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)", margin: 0 }}>
              Variance · {HORIZON_OPTIONS.find((o) => o.value === horizon)?.label}
            </p>
            <div className="metric-toggle-group">
              {(["total", "mid", "message", "worship"] as WbMetric[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWbMetric(m)}
                  className={wbMetric === m ? "metric-toggle metric-toggle--active" : "metric-toggle"}
                >
                  {m === "message" ? "MSG" : m === "worship" ? "WOR" : m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <TrendChart trend={trend} metric={wbMetric} />
          <p style={{ margin: "4px 0 0", fontSize: "var(--type-caption)", color: "var(--ink-70)" }}>
            ○ moment · — median{" "}
            {wbMetric === "total" && (
              <span className="tabular">
                {(() => {
                  const vals = trend
                    .filter((pt) => pt.actualSeconds !== null && pt.plannedSeconds !== null)
                    .map((pt) => pt.actualSeconds! - pt.plannedSeconds!);
                  const sorted = [...vals].sort((a, b) => a - b);
                  const med = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
                  return med !== null ? formatDelta(med) : "—";
                })()}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Element table */}
      <div
        className="glass-card"
        style={{
          borderRadius: "var(--r-card)",
          overflow: "hidden",
          marginTop: 0,
        }}
      >
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--hairline)" }}>
          <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)", margin: 0 }}>
            Element breakdown · {slotSummary.slotLabel}
          </p>
        </div>
        <ElementTable elements={data.elements} />
      </div>
      <Toast message={toast} onDismiss={dismissToast} />
    </main>
  );
}

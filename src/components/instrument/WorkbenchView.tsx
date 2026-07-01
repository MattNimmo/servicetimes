"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  CrossCampusMedian,
  PhaseKey,
  TrendPoint,
  WorkbenchData,
  WorkbenchElementRow,
  WorkbenchHorizon,
} from "@/lib/instrument/queries";
import { formatDelta, formatDuration, formatServiceDate } from "@/lib/variance/format";

const CAMPUS_CODES = ["SLP", "MG", "ELK", "LV"] as const;
const CAMPUS_COLORS: Record<string, string> = {
  SLP: "var(--slp)",
  MG: "var(--mg)",
  ELK: "var(--elk)",
  LV: "var(--lv)",
};

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
        <p style={{ color: "var(--ink-55)", fontSize: 11, margin: 0 }}>No data</p>
      </div>
    );
  }

  const deltas = trend.map((pt) => {
    let actual: number | null = null;
    let planned: number | null = null;
    if (metric === "total") {
      actual = pt.actualSeconds;
      planned = pt.plannedSeconds;
    } else if (metric === "mid") {
      actual = pt.midActualSeconds;
      planned = pt.midPlannedSeconds;
    } else if (metric === "message") {
      actual = pt.messageActualSeconds;
      planned = pt.messagePlannedSeconds;
    } else {
      actual = pt.worshipActualSeconds;
      planned = pt.worshipPlannedSeconds;
    }
    return actual !== null && planned !== null ? actual - planned : null;
  });
  const validDeltas = deltas.filter((d): d is number => d !== null);
  const maxAbs = Math.max(600, ...validDeltas.map(Math.abs));

  const W = 400,
    H = 120,
    padX = 20,
    padY = 14;
  const chartW = W - 2 * padX;
  const chartH = H - 2 * padY;
  const centerY = padY + chartH / 2;

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

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: 120 }}
      aria-hidden
    >
      <line
        x1={padX}
        y1={centerY}
        x2={W - padX}
        y2={centerY}
        stroke="rgba(28,32,48,0.13)"
        strokeWidth={1}
      />
      {medianY !== null && (
        <line
          x1={padX}
          y1={medianY}
          x2={W - padX}
          y2={medianY}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.7}
        />
      )}
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke="rgba(28,32,48,0.18)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      {pts.map((pt, i) => {
        if (pt.y === null) {
          return (
            <circle
              key={i}
              cx={pt.x}
              cy={centerY}
              r={3.5}
              fill="none"
              stroke="var(--ink-55)"
              strokeWidth={1.5}
            />
          );
        }
        const color =
          pt.delta === 0
            ? "var(--ink-55)"
            : (pt.delta ?? 0) > 0
              ? "var(--over)"
              : "var(--under)";
        return pt.isMoment ? (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={3.5}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
          />
        ) : (
          <circle key={i} cx={pt.x} cy={pt.y} r={3} fill={color} />
        );
      })}
    </svg>
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
          background: "rgba(28,32,48,0.1)",
          borderRadius: 999,
        }}
      />
    );
  }
  const delta = actual - planned;
  const fraction = Math.min(Math.abs(delta) / planned, 1) * 0.48;
  const pct = fraction * 100;
  const isOver = delta > 0;

  return (
    <div
      style={{
        position: "relative",
        height: 4,
        background: "rgba(28,32,48,0.08)",
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
          background: "rgba(28,32,48,0.3)",
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      {medians.map((m) => {
        const pct = ((m.medianSeconds ?? 0) / max) * 100;
        const color = CAMPUS_COLORS[m.campusCode] ?? "var(--ink-55)";
        return (
          <div key={m.campusCode} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 28,
                fontSize: "var(--type-micro)",
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: m.isActive ? "var(--ink)" : "var(--ink-55)",
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
                background: "rgba(28,32,48,0.08)",
                overflow: "hidden",
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
                color: m.isActive ? "var(--ink)" : "var(--ink-55)",
              }}
            >
              {m.medianSeconds !== null ? formatDuration(m.medianSeconds) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ElementTable({ elements }: { elements: WorkbenchElementRow[] }) {
  if (elements.length === 0) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--ink-55)", fontSize: 13 }}>
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
    <div>
      {/* Table header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "180px 56px 1fr 96px",
          gap: 8,
          padding: "8px 16px",
          borderBottom: "1px solid rgba(28,32,48,0.1)",
        }}
      >
        {["ELEMENT", "ALLOT", "", "ACTUAL · Δ"].map((h, i) => (
          <span
            key={i}
            style={{
              fontSize: "var(--type-micro)",
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "var(--ink-55)",
              textTransform: "uppercase",
            }}
          >
            {h}
          </span>
        ))}
      </div>

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
          <div key={section.key}>
            {/* Section header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "180px 56px 1fr 96px",
                gap: 8,
                padding: "10px 16px 6px",
                background: "rgba(28,32,48,0.04)",
                borderBottom: "1px solid rgba(28,32,48,0.07)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--type-micro)",
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "var(--ink)",
                  textTransform: "uppercase",
                  gridColumn: "1 / 3",
                }}
              >
                {section.name}
              </span>
              <span />
              <span
                className="tabular"
                style={{ fontSize: "var(--type-caption)", color: "var(--ink-55)", textAlign: "right" }}
              >
                {formatDuration(sectionPlanned)} · {formatDuration(sectionActual)}
              </span>
            </div>

            {/* Element rows */}
            {sectionElements.map((el) => {
              const delta =
                el.actualSeconds !== null
                  ? el.actualSeconds - el.plannedSeconds
                  : null;
              return (
                <div
                  key={el.elementKey}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 56px 1fr 96px",
                    gap: 8,
                    padding: "8px 16px",
                    borderBottom: "1px solid rgba(28,32,48,0.05)",
                    alignItems: "center",
                  }}
                >
                  {/* Element name */}
                  <span style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                    {el.elementName}
                    {el.isHumanAdjusted && (
                      <span
                        style={{
                          fontSize: "var(--type-micro)",
                          fontWeight: 700,
                          letterSpacing: "0.1em",
                          padding: "1px 4px",
                          borderRadius: 4,
                          border: "1px solid var(--accent)",
                          color: "var(--accent)",
                        }}
                      >
                        ADJ
                      </span>
                    )}
                  </span>

                  {/* Allotted */}
                  <span
                    className="tabular"
                    style={{ fontSize: 11, color: "var(--ink-55)" }}
                  >
                    {formatDuration(el.plannedSeconds)}
                  </span>

                  {/* Bar */}
                  <DivergingBar planned={el.plannedSeconds} actual={el.actualSeconds} />

                  {/* Actual + delta */}
                  {el.isBlocked ? (
                    <span
                      style={{
                        fontSize: "var(--type-micro)",
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        padding: "2px 6px",
                        borderRadius: 999,
                        background: "rgba(185,106,20,0.1)",
                        color: "var(--amber-text)",
                        textAlign: "center",
                      }}
                    >
                      NEEDS REVIEW
                    </span>
                  ) : (
                    <span
                      className="tabular"
                      style={{
                        fontSize: 11,
                        textAlign: "right",
                        color:
                          delta === null
                            ? "var(--ink-55)"
                            : delta > 0
                              ? "var(--over)"
                              : delta < 0
                                ? "var(--under)"
                                : "var(--ink)",
                      }}
                    >
                      {formatDuration(el.actualSeconds)}{" "}
                      {delta !== null && (
                        <span style={{ fontSize: "var(--type-caption)" }}>
                          {formatDelta(delta)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
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
  const [wbMetric, setWbMetric] = useState<WbMetric>("total");

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

  const { slot: slotSummary, phases, trend, allCampusMedians, referenceTargetSeconds } = data;
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
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {CAMPUS_CODES.map((code) => {
          const active = campus === code;
          const color = CAMPUS_COLORS[code];
          return (
            <button
              key={code}
              type="button"
              onClick={() => navigate({ campus: code })}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: active ? `2px solid ${color}` : "2px solid transparent",
                background: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)",
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: "0.12em",
                cursor: "pointer",
                color: active ? color : "var(--ink-55)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: color,
                  display: "inline-block",
                }}
              />
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
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-55)" }}>
          {data.campus.name}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
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
        <div className="glass-card wb-tile wb-tile--span2" style={{ borderRadius: "var(--r-card)", padding: "18px 20px" }}>
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
                color: delta === null ? "var(--ink-55)" : delta > 0 ? "var(--over)" : delta < 0 ? "var(--under)" : "var(--ink)",
              }}
            >
              {formatDelta(delta)}
            </p>
          </div>
          <p style={{ margin: "4px 0 12px", fontSize: "var(--type-caption)", color: "var(--ink-55)", letterSpacing: "0.1em" }}>
            VS PROV. TARGET · n={trend.length}
          </p>

          {/* Phase bar */}
          <div className="phase-bar" aria-hidden>
            {PHASE_META.map((ph) => {
              const width =
                totalPlanned > 0
                  ? (phases[ph.key].plannedSeconds / totalPlanned) * 100
                  : 0;
              return (
                <span
                  key={ph.key}
                  className={`phase-bar__segment phase-chip--${ph.key.replace("_", "-").split("_")[0]}`}
                  style={{ width: `${width}%` }}
                />
              );
            })}
          </div>

          {/* Phase legend */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 10 }}>
            {PHASE_META.map((ph) => (
              <div key={ph.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "var(--type-micro)", fontWeight: 700, letterSpacing: "0.12em", color: "var(--ink-55)", textTransform: "uppercase" }}>
                  {ph.label}
                </span>
                <span
                  className="tabular"
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: ph.key === "mid_service" ? "var(--amber-text)" : "var(--ink)",
                  }}
                >
                  {formatDuration(phases[ph.key].actualSeconds)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Broadcast window tile – span 2 */}
        <div className="glass-card wb-tile wb-tile--span2" style={{ borderRadius: "var(--r-card)", padding: "18px 20px" }}>
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
            <p style={{ margin: "8px 0 12px", fontSize: 13, color: "var(--ink-55)" }}>
              No broadcast window recorded yet.
            </p>
          )}

          {/* Mini phase bar highlighting Live */}
          <div
            style={{
              display: "flex",
              height: 6,
              borderRadius: 999,
              overflow: "hidden",
              background: "rgba(28,32,48,0.08)",
            }}
          >
            {PHASE_META.map((ph) => {
              const width =
                totalPlanned > 0
                  ? (phases[ph.key].plannedSeconds / totalPlanned) * 100
                  : 0;
              return (
                <div
                  key={ph.key}
                  style={{
                    width: `${width}%`,
                    background: ph.key === "live" ? "var(--accent)" : "rgba(28,32,48,0.15)",
                  }}
                />
              );
            })}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "var(--type-caption)", color: "var(--ink-55)", letterSpacing: "0.08em" }}>
            LIVE → END · the message block, after mid &amp; before local
          </p>
        </div>

        {/* Mid lever tile */}
        <div
          className="glass-card wb-tile"
          style={{
            borderRadius: "var(--r-card)",
            padding: "18px 20px",
            background: "rgba(217,138,32,0.08)",
          }}
        >
          <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)", color: "var(--amber-text)" }}>
            Mid · the lever
          </p>
          <p
            className="tabular"
            style={{ margin: "8px 0 0", fontSize: "clamp(1.6rem,2.8vw,2.2rem)", fontWeight: 700, letterSpacing: "-0.05em", color: "var(--amber-text)" }}
          >
            {formatDuration(midPhase.actualSeconds)}
          </p>
          <p
            className="tabular"
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              fontWeight: 700,
              color: midDelta === null ? "var(--ink-55)" : midDelta > 0 ? "var(--over)" : "var(--under)",
            }}
          >
            {formatDelta(midDelta)}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: "var(--type-caption)", color: "var(--amber-text)", letterSpacing: "0.08em" }}>
            THE PART YOU ACTUALLY CONTROL
          </p>
        </div>

        {/* Cross tile */}
        <div className="glass-card wb-tile" style={{ borderRadius: "var(--r-card)", padding: "18px 20px" }}>
          <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)" }}>
            Cross · close worship
          </p>
          <CrossMedianBars medians={allCampusMedians} />
        </div>

        {/* Trend tile – span 2 */}
        <div className="glass-card wb-tile wb-tile--span2" style={{ borderRadius: "var(--r-card)", padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)", margin: 0 }}>
              Variance · {HORIZON_OPTIONS.find((o) => o.value === horizon)?.label}
            </p>
            <div style={{ display: "flex", gap: 4 }}>
              {(["total", "mid", "message", "worship"] as WbMetric[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWbMetric(m)}
                  style={{
                    fontSize: "var(--type-micro)",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    padding: "2px 7px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: wbMetric === m ? "rgba(255,255,255,0.9)" : "transparent",
                    color: wbMetric === m ? "var(--ink)" : "var(--ink-55)",
                    textTransform: "uppercase",
                  }}
                >
                  {m === "message" ? "MSG" : m === "worship" ? "WOR" : m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <TrendChart trend={trend} metric={wbMetric} />
          <p style={{ margin: "4px 0 0", fontSize: "var(--type-caption)", color: "var(--ink-55)" }}>
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
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(28,32,48,0.1)" }}>
          <p className="instrument-eyebrow" style={{ fontSize: "var(--type-micro)", margin: 0 }}>
            Element breakdown · {slotSummary.slotLabel}
          </p>
        </div>
        <ElementTable elements={data.elements} />
      </div>
    </main>
  );
}

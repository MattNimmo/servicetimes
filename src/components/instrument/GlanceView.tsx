"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { GlanceCampus, PhaseKey, ServiceSlotSummary } from "@/lib/instrument/queries";
import { formatDelta, formatDuration, formatServiceDate } from "@/lib/variance/format";

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

function verdictLabel(campus: GlanceCampus, selectedSlot: ServiceSlotSummary | undefined) {
  if (!selectedSlot) return "No production slot is mapped yet.";
  if (selectedSlot.isBlocked) return "Operator review is still blocking this slot.";
  if (selectedSlot.actualSeconds === null) return "Broadcast actual has not fully landed yet.";

  const delta = selectedSlot.actualSeconds - campus.referenceTargetSeconds;
  if (delta <= 0) return "Cleared the provisional target.";
  if (delta <= 60) return "Within normal range and only slightly over target.";
  if (campus.openIncidentCount > 0) {
    return `${campus.openIncidentCount} review item${campus.openIncidentCount === 1 ? "" : "s"} should be checked next.`;
  }
  return "Above target — use Workbench to inspect the service flow.";
}

function totalPlannedSeconds(campus: GlanceCampus) {
  return Object.values(campus.phases).reduce(
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
  medium: "var(--amber-text)",
  low: "var(--ink-55)",
};

function buildRecommendations(
  campus: GlanceCampus,
  selectedSlot: ServiceSlotSummary | undefined,
  mode: "actuals" | "awaiting",
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
    const midActual = campus.phases.mid_service.actualSeconds;
    const midPlanned = campus.phases.mid_service.plannedSeconds;
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
          label: `Service ran ${formatDelta(totalDelta)} over the provisional target`,
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
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--ink-55)",
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
                background: "rgba(28,32,48,0.04)",
                borderLeft: `3px solid ${URGENCY_COLOR[rec.urgency]}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>
                  {rec.label}
                </p>
                <p style={{ margin: 0, fontSize: 10, color: "var(--ink-55)", lineHeight: 1.4 }}>
                  {rec.detail}
                </p>
              </div>
              <a
                href={rec.actionHref}
                style={{
                  fontSize: 9,
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

export default function GlanceView({ campuses }: { campuses: GlanceCampus[] }) {
  const [mode, setMode] = useState<"actuals" | "awaiting">("actuals");
  const [recWindow, setRecWindow] = useState<6 | 12>(6);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(campuses.map((campus) => [campus.code, true])),
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
        const totalPlanned = totalPlannedSeconds(campus);
        const recs = buildRecommendations(campus, selectedSlot, mode);

        return {
          campus,
          selectedSlot,
          totalPlanned,
          expanded: expanded[campus.code] ?? true,
          recs,
          midDelta:
            campus.phases.mid_service.actualSeconds !== null
              ? campus.phases.mid_service.actualSeconds -
                campus.phases.mid_service.plannedSeconds
              : null,
        };
      }),
    [campuses, expanded, glanceSvc, mode],
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
        {campusCards.map(({ campus, selectedSlot, totalPlanned, expanded: isExpanded, recs, midDelta }) => {
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
                    [campus.code]: !(current[campus.code] ?? true),
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
                  <span className="status-pill">{statusLabel(campus, selectedSlot, mode)}</span>
                  <span className="glance-card__chevron">{isExpanded ? "▾" : "▸"}</span>
                </div>
              </button>

              <div className="glance-card__body">
                <div className="glance-card__total-row">
                  <div>
                    <p className="glance-card__label">
                      {selectedSlot?.slotLabel ?? "No slot"} · total · provisional target
                    </p>
                    <p className="glance-card__total tabular">
                      {formatDuration(selectedActual)}
                    </p>
                  </div>
                  <div className={`glance-card__delta${delta !== null && delta > 0 ? " glance-card__delta--over" : " glance-card__delta--under"}`}>
                    {formatDelta(delta)}
                  </div>
                </div>

                {campus.slots.length > 1 ? (
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
                    <div className="phase-bar" aria-hidden>
                      {PHASE_META.map((phase) => {
                        const amount = campus.phases[phase.key].plannedSeconds;
                        const width = totalPlanned > 0 ? (amount / totalPlanned) * 100 : 0;
                        return (
                          <span
                            key={phase.key}
                            className={`phase-bar__segment ${phase.className}`}
                            style={{ width: `${width}%` }}
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
                            {formatDuration(campus.phases[phase.key].actualSeconds)}
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
                          background: "rgba(217,138,32,0.08)",
                          border: "1px solid rgba(217,138,32,0.14)",
                        }}
                      >
                        <p
                          style={{
                            margin: "0 0 1px",
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.2em",
                            textTransform: "uppercase",
                            color: "var(--amber-text)",
                          }}
                        >
                          Mid-service · the lever
                        </p>
                        <p
                          style={{
                            margin: "0 0 6px",
                            fontSize: 9,
                            color: "var(--amber-text)",
                            opacity: 0.75,
                          }}
                        >
                          the part you actually control
                        </p>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                          <span
                            className="tabular"
                            style={{ fontSize: 26, fontWeight: 700, color: "var(--ink)" }}
                          >
                            {formatDuration(campus.phases.mid_service.actualSeconds)}
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
                        <strong className="tabular">{campus.openIncidentCount}</strong>
                      </div>
                      <div className="glance-metric">
                        <span>Unmapped</span>
                        <strong className="tabular">{campus.unmappedCount}</strong>
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
    </main>
  );
}

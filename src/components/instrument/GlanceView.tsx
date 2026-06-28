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

        return {
          campus,
          selectedSlot,
          totalPlanned,
          expanded: expanded[campus.code] ?? true,
        };
      }),
    [campuses, expanded, glanceSvc],
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
        {campusCards.map(({ campus, selectedSlot, totalPlanned, expanded: isExpanded }) => {
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
                          <span>{phase.label}</span>
                          <strong className="tabular">
                            {formatDuration(campus.phases[phase.key].actualSeconds)}
                          </strong>
                        </div>
                      ))}
                    </div>

                    <p className="glance-card__verdict">{verdictLabel(campus, selectedSlot)}</p>

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

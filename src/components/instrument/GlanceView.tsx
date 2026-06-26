"use client";

import { useState } from "react";

import type { GlanceCampus, PhaseKey } from "@/lib/instrument/queries";
import { formatDuration } from "@/lib/variance/format";

function formatSigned(seconds: number | null) {
  if (seconds === null) return "—";
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  const value = `${minutes}:${String(remainder).padStart(2, "0")}`;
  return seconds > 0 ? `+${value}` : seconds < 0 ? `−${value}` : "0:00";
}

const PHASE_LABELS: Record<PhaseKey, string> = {
  worship_open: "Worship",
  mid_service: "Mid",
  live: "Live",
  local: "Local",
};

const PHASE_COLORS: Record<PhaseKey, string> = {
  worship_open: "var(--phase-worship)",
  mid_service: "var(--phase-mid)",
  live: "var(--phase-live)",
  local: "var(--phase-local)",
};

const CAMPUS_COLORS: Record<string, string> = {
  ELK: "var(--elk)",
  LV: "var(--lv)",
  MG: "var(--mg)",
  SLP: "var(--slp)",
};

export default function GlanceView({ campuses }: { campuses: GlanceCampus[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedSlot, setSelectedSlot] = useState<Record<string, string>>({});

  return (
    <main style={{ maxWidth: 1360, margin: "0 auto", padding: "32px 24px 64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 11, letterSpacing: "0.18em", color: "var(--ink-55)", fontWeight: 600 }}>
            THE MONDAY GLANCE
          </p>
          <h1 style={{ marginTop: 12, fontSize: 40, lineHeight: 1.05, fontWeight: 700 }}>
            Where did each campus land?
          </h1>
          <p style={{ marginTop: 12, maxWidth: 760, color: "var(--ink-55)", lineHeight: 1.6 }}>
            A fast read on total service timing, tracked phases, and the amount of
            cleanup still waiting on each campus.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
          gap: 18,
          marginTop: 28,
        }}
      >
        {campuses.map((campus) => {
          const activeSlot =
            campus.slots.find((slot) => slot.slotLabel === selectedSlot[campus.code]) ??
            campus.slots[0] ??
            null;
          const totalTracked =
            Object.values(campus.phases).reduce(
              (sum, phase) => sum + (phase.actualSeconds ?? 0),
              0,
            ) || 0;
          const verdictCount = campus.openIncidentCount + campus.unmappedCount;
          const totalPlanned = Object.values(campus.phases).reduce(
            (sum, phase) => sum + phase.plannedSeconds,
            0,
          );
          const delta =
            activeSlot?.actualSeconds !== null && activeSlot
              ? activeSlot.actualSeconds - campus.referenceTargetSeconds
              : null;

          return (
            <section
              key={campus.code}
              className="instrument-glass instrument-tabular"
              style={{ borderRadius: "var(--r-glance)", padding: 22, color: "var(--ink)" }}
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded((current) => ({
                    ...current,
                    [campus.code]: !current[campus.code],
                  }))
                }
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  textAlign: "left",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 16 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: 999,
                          background: CAMPUS_COLORS[campus.code],
                          boxShadow: `0 0 0 4px color-mix(in srgb, ${CAMPUS_COLORS[campus.code]} 22%, transparent)`,
                        }}
                      />
                      <strong style={{ fontSize: 18 }}>{campus.name}</strong>
                    </div>
                    <p style={{ marginTop: 6, fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-55)" }}>
                      {campus.slots.map((slot) => slot.slotLabel).join(" · ")} · {campus.serviceDate}
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: 20,
                      color: "var(--ink-55)",
                      transform: expanded[campus.code] ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: "transform 140ms ease",
                    }}
                  >
                    ▾
                  </span>
                </div>

                <div style={{ marginTop: 18, display: "grid", gap: 8 }}>
                  <p style={{ fontSize: 11, letterSpacing: "0.18em", color: "var(--ink-55)", fontWeight: 600 }}>
                    TOTAL SERVICE
                  </p>
                  <div style={{ display: "flex", alignItems: "end", gap: 14, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 46, lineHeight: 1, fontWeight: 700 }}>
                      {formatDuration(activeSlot?.actualSeconds ?? null)}
                    </div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
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
                      {formatSigned(delta)}
                    </div>
                  </div>
                  <p style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--ink-55)" }}>
                    {activeSlot?.slotLabel ?? "—"} · TOTAL · PROVISIONAL TARGET
                  </p>
                </div>
              </button>

              <div style={{ marginTop: 18 }}>
                <div
                  style={{
                    position: "relative",
                    height: 13,
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "rgba(28,32,48,0.08)",
                  }}
                >
                  {(Object.entries(campus.phases) as [PhaseKey, GlanceCampus["phases"][PhaseKey]][]).map(
                    ([key, phase]) => (
                      <div
                        key={key}
                        style={{
                          width: `${totalPlanned > 0 ? (phase.plannedSeconds / totalPlanned) * 100 : 0}%`,
                          height: "100%",
                          float: "left",
                          background: PHASE_COLORS[key],
                        }}
                      />
                    ),
                  )}
                </div>
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(Object.entries(campus.phases) as [PhaseKey, GlanceCampus["phases"][PhaseKey]][]).map(
                    ([key, phase]) => (
                      <span
                        key={key}
                        style={{
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.58)",
                          padding: "6px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {PHASE_LABELS[key]} · {formatDuration(phase.actualSeconds)}
                      </span>
                    ),
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16, color: verdictCount > 0 ? "var(--amber-text)" : "var(--under)", fontWeight: 600 }}>
                {verdictCount > 0
                  ? `${verdictCount} structural fixes to review`
                  : "✓ Cleared the target"}
              </div>

              {expanded[campus.code] ? (
                <div style={{ marginTop: 18, borderTop: "1px solid rgba(28,32,48,0.08)", paddingTop: 18 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {campus.slots.map((slot) => {
                      const active = activeSlot?.slotId === slot.slotId;
                      return (
                        <button
                          key={slot.slotId}
                          type="button"
                          onClick={() =>
                            setSelectedSlot((current) => ({
                              ...current,
                              [campus.code]: slot.slotLabel,
                            }))
                          }
                          style={{
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.7)",
                            background: active ? "#fff" : "rgba(255,255,255,0.4)",
                            boxShadow: active ? "0 1px 4px rgba(50,52,90,0.10)" : "none",
                            padding: "7px 12px",
                            fontSize: 11,
                            fontWeight: 700,
                            color: "var(--ink)",
                            cursor: "pointer",
                          }}
                        >
                          {slot.slotLabel} · {formatDuration(slot.actualSeconds)}
                        </button>
                      );
                    })}
                  </div>

                  <div
                    className="instrument-glass"
                    style={{
                      marginTop: 16,
                      borderRadius: 14,
                      padding: 16,
                      background: "rgba(217,138,32,0.08)",
                    }}
                  >
                    <p style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--amber-text)", fontWeight: 700 }}>
                      MID-SERVICE · THE LEVER
                    </p>
                    <div style={{ marginTop: 8, display: "flex", alignItems: "end", gap: 12 }}>
                      <strong style={{ fontSize: 28 }}>{formatDuration(campus.phases.mid_service.actualSeconds)}</strong>
                      <span style={{ color: "var(--amber-text)", fontWeight: 700 }}>
                        {formatSigned(
                          campus.phases.mid_service.actualSeconds === null
                            ? null
                            : campus.phases.mid_service.actualSeconds -
                              campus.phases.mid_service.plannedSeconds,
                        )}
                      </span>
                    </div>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <p style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-55)", fontWeight: 700 }}>
                      RECOMMENDATIONS
                    </p>
                    <p style={{ marginTop: 8, color: "var(--ink-55)" }}>
                      No recommendations yet · Phase 3
                    </p>
                  </div>

                  <div style={{ marginTop: 16, color: "var(--ink-55)", fontSize: 12 }}>
                    TRACKED ELEMENTS · {formatDuration(totalTracked)}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}

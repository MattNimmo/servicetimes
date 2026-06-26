"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { CampusCode, WorkbenchData, WorkbenchHorizon } from "@/lib/instrument/queries";
import { formatDuration, formatServiceDate } from "@/lib/variance/format";

function formatSigned(seconds: number | null) {
  if (seconds === null) return "—";
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  const value = `${minutes}:${String(remainder).padStart(2, "0")}`;
  return seconds > 0 ? `+${value}` : seconds < 0 ? `−${value}` : "0:00";
}

function formatBroadcastTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours >= 12 ? "p" : "a";
  return `${hours > 12 ? hours - 12 : hours || 12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

const CAMPUS_CODES: CampusCode[] = ["ELK", "LV", "MG", "SLP"];
const HORIZONS: WorkbenchHorizon[] = ["last", "6wk", "6mo", "12mo"];
const CAMPUS_COLORS: Record<string, string> = {
  ELK: "var(--elk)",
  LV: "var(--lv)",
  MG: "var(--mg)",
  SLP: "var(--slp)",
};

export default function WorkbenchView({
  data,
  availableSlots,
  horizon,
}: {
  data: WorkbenchData;
  availableSlots: string[];
  horizon: WorkbenchHorizon;
}) {
  const [metric, setMetric] = useState<"total" | "mid" | "message" | "worship">("total");
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateSearch = (updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) next.set(key, value);
    router.push(`/instrument/workbench?${next.toString()}`);
  };

  const groupedElements = useMemo(() => {
    return data.elements.reduce<Record<string, typeof data.elements>>((groups, row) => {
      groups[row.sectionName] ??= [];
      groups[row.sectionName].push(row);
      return groups;
    }, {});
  }, [data]);

  const spreadValues = data.allCampusMedians
    .map((row) => row.medianSeconds)
    .filter((value): value is number => value !== null);
  const spread =
    spreadValues.length > 0 ? Math.max(...spreadValues) - Math.min(...spreadValues) : null;
  const maxMedian = spreadValues.length > 0 ? Math.max(...spreadValues) : 1;

  return (
    <main style={{ maxWidth: 1360, margin: "0 auto", padding: "32px 24px 64px" }}>
      <div>
        <p style={{ fontSize: 11, letterSpacing: "0.18em", color: "var(--ink-55)", fontWeight: 600 }}>
          WORKBENCH · LIVE READ
        </p>
        <h1 style={{ marginTop: 12, fontSize: 40, lineHeight: 1.05, fontWeight: 700 }}>
          {data.campus.name} · {formatServiceDate(data.serviceDate)}
        </h1>
        <p style={{ marginTop: 12, color: "var(--ink-55)", lineHeight: 1.6 }}>
          Read the selected service time in context, then compare it against recent history.
        </p>
      </div>

      <div style={{ marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {CAMPUS_CODES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => updateSearch({ campus: code })}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.7)",
              background: code === data.campus.code ? "#fff" : "rgba(255,255,255,0.4)",
              color: code === data.campus.code ? CAMPUS_COLORS[code] : "var(--ink-55)",
              padding: "7px 12px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {code}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: "rgba(28,32,48,0.12)", margin: "0 4px" }} />
        {availableSlots.map((slot) => (
          <button
            key={slot}
            type="button"
            onClick={() => updateSearch({ slot })}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.7)",
              background: slot === data.slot.slotLabel ? "#fff" : "rgba(255,255,255,0.4)",
              color: "var(--ink)",
              padding: "7px 12px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {slot}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: "rgba(28,32,48,0.12)", margin: "0 4px" }} />
        {HORIZONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => updateSearch({ horizon: option })}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.7)",
              background: option === horizon ? "#fff" : "rgba(255,255,255,0.4)",
              color: "var(--ink)",
              padding: "7px 12px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {option.toUpperCase()}
          </button>
        ))}
      </div>

      <section
        style={{
          marginTop: 24,
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        <article className="instrument-glass instrument-tabular" style={{ borderRadius: 16, padding: 18, gridColumn: "span 2" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-55)", fontWeight: 700 }}>
            TOTAL SERVICE · {horizon.toUpperCase()}
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 46, lineHeight: 1 }}>{formatDuration(data.slot.actualSeconds)}</strong>
            <span style={{ fontWeight: 700, color: data.slot.variance.deltaSeconds && data.slot.variance.deltaSeconds > 0 ? "var(--over)" : "var(--under)" }}>
              {formatSigned(data.slot.variance.deltaSeconds)}
            </span>
          </div>
          <p style={{ marginTop: 6, color: "var(--ink-55)", fontSize: 12 }}>
            VS PROV. TARGET · n={data.trend.length}
          </p>
        </article>

        <article className="instrument-glass instrument-tabular" style={{ borderRadius: 16, padding: 18, gridColumn: "span 2" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--accent)", fontWeight: 700 }}>
            BROADCAST WINDOW
          </p>
          <div style={{ marginTop: 12, fontSize: 28, fontWeight: 700 }}>
            {formatBroadcastTime(data.slot.broadcastStartsAt)} → {formatBroadcastTime(data.slot.broadcastEndsAt)}
          </div>
          <p style={{ marginTop: 8, color: "var(--ink-55)" }}>
            {data.slot.actualSeconds !== null ? `${Math.round(data.slot.actualSeconds / 60)} MIN LIVE` : "NEEDS REVIEW"}
          </p>
        </article>

        <article className="instrument-glass instrument-tabular" style={{ borderRadius: 16, padding: 18 }}>
          <p style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--amber-text)", fontWeight: 700 }}>
            MID · THE LEVER
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 32 }}>{formatDuration(data.phases.mid_service.actualSeconds)}</strong>
            <span style={{ color: "var(--amber-text)", fontWeight: 700 }}>
              {formatSigned(
                data.phases.mid_service.actualSeconds === null
                  ? null
                  : data.phases.mid_service.actualSeconds - data.phases.mid_service.plannedSeconds,
              )}
            </span>
          </div>
        </article>

        <article className="instrument-glass instrument-tabular" style={{ borderRadius: 16, padding: 18 }}>
          <p style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-55)", fontWeight: 700 }}>
            CROSS · CLOSE WORSHIP
          </p>
          <div style={{ marginTop: 12, fontSize: 30, fontWeight: 700 }}>{formatDuration(spread)}</div>
          <p style={{ marginTop: 8, color: "var(--ink-55)" }}>Spread across campus medians</p>
        </article>

        <article className="instrument-glass instrument-tabular" style={{ borderRadius: 16, padding: 18, gridColumn: "span 2" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <p style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-55)", fontWeight: 700 }}>
              VARIANCE · TREND
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["total", "mid", "message", "worship"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMetric(option)}
                  style={{
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.7)",
                    background: metric === option ? "#fff" : "rgba(255,255,255,0.4)",
                    color: "var(--ink)",
                    padding: "6px 10px",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {metric === "total" ? (
            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
              {data.trend.map((point) => (
                <div key={point.serviceDate} style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 10, alignItems: "center" }}>
                  <span style={{ color: "var(--ink-55)", fontSize: 12 }}>{point.serviceDate}</span>
                  <div style={{ height: 8, borderRadius: 999, background: "rgba(28,32,48,0.08)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.min(
                          100,
                          Math.abs(point.actualSeconds ?? 0) /
                            Math.max(1, data.referenceTargetSeconds) *
                            100,
                        )}%`,
                        height: "100%",
                        background: point.actualSeconds === null
                          ? "var(--amber-fill)"
                          : (point.actualSeconds ?? 0) >= data.referenceTargetSeconds
                            ? "var(--over)"
                            : "var(--under)",
                      }}
                    />
                  </div>
                  <span>{formatDuration(point.actualSeconds)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ marginTop: 16, color: "var(--ink-55)" }}>
              {metric.toUpperCase()} trend not yet wired to real history in this first slice.
            </p>
          )}
        </article>

        <article className="instrument-glass instrument-tabular" style={{ borderRadius: 16, padding: 18, gridColumn: "span 2" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-55)", fontWeight: 700 }}>
            CAMPUS MEDIANS
          </p>
          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            {data.allCampusMedians.map((row) => (
              <div key={row.campusCode} style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 12, alignItems: "center" }}>
                <strong style={{ color: row.isActive ? CAMPUS_COLORS[row.campusCode] : "var(--ink)" }}>{row.campusCode}</strong>
                <div style={{ height: 8, borderRadius: 999, background: "rgba(28,32,48,0.08)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.min(100, ((row.medianSeconds ?? 0) / Math.max(1, maxMedian)) * 100)}%`,
                      height: "100%",
                      background: row.isActive ? CAMPUS_COLORS[row.campusCode] : "var(--phase-worship)",
                    }}
                  />
                </div>
                <span>{formatDuration(row.medianSeconds)}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="instrument-glass instrument-tabular" style={{ marginTop: 20, borderRadius: 16, padding: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "184px 80px 1fr 120px", gap: 16, fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-55)", fontWeight: 700 }}>
          <span>ELEMENT</span>
          <span>ALLOT</span>
          <span>DELTA</span>
          <span>ACTUAL</span>
        </div>
        <div style={{ marginTop: 14, display: "grid", gap: 20 }}>
          {Object.entries(groupedElements).map(([sectionName, rows]) => (
            <div key={sectionName}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <strong style={{ fontSize: 12, letterSpacing: "0.14em", color: "var(--ink-55)" }}>{sectionName.toUpperCase()}</strong>
                <span style={{ color: "var(--ink-55)", fontSize: 12 }}>
                  {formatDuration(rows.reduce((sum, row) => sum + row.plannedSeconds, 0))} allot ·{" "}
                  {formatDuration(rows.reduce((sum, row) => sum + (row.actualSeconds ?? 0), 0))} actual
                </span>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {rows.map((row) => (
                  <div key={row.elementKey} style={{ display: "grid", gridTemplateColumns: "184px 80px 1fr 120px", gap: 16, alignItems: "center" }}>
                    <span>{row.elementName}</span>
                    <span>{formatDuration(row.plannedSeconds)}</span>
                    <div style={{ height: 8, borderRadius: 999, background: "rgba(28,32,48,0.08)", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min(100, Math.abs(row.variance.deltaSeconds ?? 0) / Math.max(1, row.plannedSeconds) * 100)}%`,
                          height: "100%",
                          background: row.isBlocked
                            ? "var(--amber-fill)"
                            : (row.variance.deltaSeconds ?? 0) >= 0
                              ? "var(--over)"
                              : "var(--under)",
                        }}
                      />
                    </div>
                    <span>{row.isBlocked ? "NEEDS REVIEW" : formatDuration(row.actualSeconds)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

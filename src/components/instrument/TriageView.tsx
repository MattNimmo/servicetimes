"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import {
  mapItemToElementAction,
  resolveReviewIncidentAction,
  resolveSlotResolutionIncidentAction,
} from "@/lib/operator/review-actions";
import type {
  AvailableElement,
  SlotIncident,
  TriageData,
  TriageItem,
  TriageItemIncident,
  TriageSection,
  TriageSlot,
} from "@/lib/instrument/queries";
import { formatDuration, formatServiceDate } from "@/lib/variance/format";
import CorrectModal, { type CorrectModalPayload } from "./CorrectModal";
import Toast from "./Toast";

const CAMPUS_CODES = ["SLP", "MG", "ELK", "LV"] as const;

const STATUS_CONFIG = {
  good: {
    borderColor: "transparent",
    bg: "transparent",
    chipColor: "var(--under)",
    chipBg: "rgba(46,156,107,0.1)",
    label: "✓ MAPPED",
  },
  not_tracked: {
    borderColor: "transparent",
    bg: "transparent",
    chipColor: "var(--ink-35, rgba(28,32,48,0.35))",
    chipBg: "rgba(28,32,48,0.06)",
    label: "NOT TRACKED",
  },
  rollup: {
    borderColor: "var(--amber-text)",
    bg: "rgba(185,106,20,0.04)",
    chipColor: "var(--amber-text)",
    chipBg: "rgba(185,106,20,0.1)",
    label: "ROLL-UP?",
  },
  unmapped: {
    borderColor: "var(--amber-text)",
    bg: "rgba(185,106,20,0.04)",
    chipColor: "var(--amber-text)",
    chipBg: "rgba(185,106,20,0.1)",
    label: "UNMAPPED",
  },
  incident: {
    borderColor: "var(--over)",
    bg: "rgba(207,82,44,0.04)",
    chipColor: "var(--over)",
    chipBg: "rgba(207,82,44,0.1)",
    label: "INCIDENT",
  },
  resolved: {
    borderColor: "transparent",
    bg: "transparent",
    chipColor: "var(--under)",
    chipBg: "rgba(46,156,107,0.1)",
    label: "✓ RESOLVED",
  },
} as const;

function buildCumulativeMap(sections: TriageSection[]): Map<number, number> {
  const allItems = sections
    .flatMap((s) => s.items)
    .sort((a, b) => a.sequence - b.sequence);

  const firstDuringIdx = allItems.findIndex(
    (i) =>
      i.servicePosition === "during" ||
      (i.servicePosition !== "pre" && i.servicePosition !== "post"),
  );

  const map = new Map<number, number>();
  if (firstDuringIdx === -1) {
    let cum = 0;
    for (const item of allItems) {
      map.set(item.id, cum);
      cum += item.plannedSeconds ?? 0;
    }
    return map;
  }

  let neg = 0;
  for (let i = firstDuringIdx - 1; i >= 0; i--) {
    neg -= allItems[i].plannedSeconds ?? 0;
    map.set(allItems[i].id, neg);
  }
  let cum = 0;
  for (let i = firstDuringIdx; i < allItems.length; i++) {
    map.set(allItems[i].id, cum);
    cum += allItems[i].plannedSeconds ?? 0;
  }
  return map;
}

function formatCumulative(seconds: number): string {
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const str = `${m}:${String(s).padStart(2, "0")}`;
  return seconds < 0 ? `-${str}` : str;
}

function SlotHeaderRow({
  slot,
  redirectTo,
}: {
  slot: TriageSlot;
  redirectTo: string;
}) {
  const hasIssues = slot.slotIncidents.length > 0;
  const borderColor = hasIssues ? "var(--over)" : "var(--under)";

  return (
    <div
      style={{
        borderLeft: `3px solid ${borderColor}`,
        background: "rgba(28,32,48,0.05)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>
          {slot.slotLabel}
        </span>
        {slot.pcoName && slot.pcoName !== slot.slotLabel && (
          <span style={{ fontSize: 11, color: "var(--ink-55)", marginLeft: 8 }}>
            {slot.pcoName}
          </span>
        )}
      </div>

      {hasIssues ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {slot.slotIncidents.map((inc) => (
            <SlotIncidentChip key={inc.id} incident={inc} redirectTo={redirectTo} />
          ))}
        </div>
      ) : (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "var(--under)",
          }}
        >
          ✓ NO SLOT ISSUES
        </span>
      )}
    </div>
  );
}

function SlotIncidentChip({
  incident,
  redirectTo,
}: {
  incident: SlotIncident;
  redirectTo: string;
}) {
  const label = incident.kind.replace(/_/g, " ").toUpperCase();

  if (incident.canResolveSlotResolution) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.12em",
            padding: "2px 7px",
            borderRadius: 999,
            background: "rgba(207,82,44,0.12)",
            color: "var(--over)",
          }}
        >
          {label}
        </span>
        <form action={resolveSlotResolutionIncidentAction} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="hidden" name="incidentId" value={String(incident.id)} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <select
            name="slotId"
            defaultValue=""
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 6,
              border: "1px solid rgba(28,32,48,0.2)",
              background: "rgba(255,255,255,0.7)",
            }}
          >
            <option value="" disabled>
              Map to slot…
            </option>
            {incident.availableSlots.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            name="slotResolutionAction"
            value="map"
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              border: "none",
              background: "var(--accent)",
              color: "white",
              cursor: "pointer",
            }}
          >
            Map
          </button>
          <button
            type="submit"
            name="slotResolutionAction"
            value="exclude"
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              border: "1px solid rgba(28,32,48,0.2)",
              background: "transparent",
              cursor: "pointer",
              color: "var(--ink-55)",
            }}
          >
            Exclude
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          padding: "2px 7px",
          borderRadius: 999,
          background: "rgba(207,82,44,0.12)",
          color: "var(--over)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 10, color: "var(--ink-55)", fontVariantNumeric: "tabular-nums" }}>
        {formatDuration(incident.rawActualSeconds)} actual /{" "}
        {formatDuration(incident.plannedSeconds)} plan
      </span>
    </div>
  );
}

function SectionHeaderRow({ section }: { section: TriageSection }) {
  const attentionItems = section.items.filter(
    (i) => i.status === "rollup" || i.status === "unmapped" || i.status === "incident",
  );
  const hasAttention = attentionItems.length > 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "74px 52px 1fr auto",
        gap: 8,
        padding: "8px 16px 6px",
        background: "rgba(28,32,48,0.03)",
        borderBottom: "1px solid rgba(28,32,48,0.07)",
        borderTop: "1px solid rgba(28,32,48,0.07)",
      }}
    >
      <span />
      <span />
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--ink)",
        }}
      >
        {section.sectionLabel}
      </span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          padding: "2px 7px",
          borderRadius: 999,
          background: hasAttention ? "rgba(185,106,20,0.1)" : "rgba(46,156,107,0.1)",
          color: hasAttention ? "var(--amber-text)" : "var(--under)",
        }}
      >
        {hasAttention ? `${attentionItems.length} NEED ATTENTION` : "ALL CLEAR"}
      </span>
    </div>
  );
}

function MapActions({
  item,
  redirectTo,
  availableElements,
}: {
  item: TriageItem;
  redirectTo: string;
  availableElements: AvailableElement[];
}) {
  // Group elements by section for <optgroup>
  const groups = new Map<string, AvailableElement[]>();
  for (const el of availableElements) {
    if (!groups.has(el.sectionKey)) groups.set(el.sectionKey, []);
    groups.get(el.sectionKey)!.push(el);
  }

  return (
    <form action={mapItemToElementAction} style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input type="hidden" name="itemId" value={String(item.id)} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <select
        name="elementWithSection"
        defaultValue=""
        style={{
          fontSize: 9,
          padding: "2px 4px",
          borderRadius: 6,
          border: "1px solid rgba(28,32,48,0.2)",
          background: "rgba(255,255,255,0.7)",
          maxWidth: 140,
        }}
      >
        <option value="" disabled>
          Map to…
        </option>
        {Array.from(groups.entries()).map(([sectionKey, sectionEls]) => (
          <optgroup
            key={sectionKey}
            label={sectionKey.replace(/_/g, " ").toUpperCase()}
          >
            {sectionEls.map((el) => (
              <option key={el.key} value={`${el.key}|${sectionKey}`}>
                {el.displayName}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="submit"
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: "3px 8px",
          borderRadius: 999,
          border: "none",
          background: "var(--accent)",
          color: "white",
          cursor: "pointer",
          letterSpacing: "0.1em",
        }}
      >
        Map
      </button>
    </form>
  );
}

function ItemRow({
  item,
  cumulative,
  redirectTo,
  onCorrect,
  availableElements,
}: {
  item: TriageItem;
  cumulative: number;
  redirectTo: string;
  onCorrect: (payload: CorrectModalPayload) => void;
  availableElements: AvailableElement[];
}) {
  const cfg = STATUS_CONFIG[item.status];
  const delta =
    item.actualSeconds !== null && item.plannedSeconds !== null
      ? item.actualSeconds - item.plannedSeconds
      : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "74px 52px 1fr auto",
        gap: 8,
        padding: "9px 16px",
        borderBottom: "1px solid rgba(28,32,48,0.05)",
        borderLeft: `3px solid ${cfg.borderColor}`,
        background: cfg.bg,
        alignItems: "center",
      }}
    >
      {/* Cumulative time */}
      <span
        className="tabular"
        style={{ fontSize: 10, color: "var(--ink-55)", fontWeight: 500 }}
      >
        {formatCumulative(cumulative)}
      </span>

      {/* Planned */}
      <span
        className="tabular"
        style={{ fontSize: 11, color: "var(--ink-55)" }}
      >
        {item.plannedSeconds !== null ? formatDuration(item.plannedSeconds) : "—"}
      </span>

      {/* Title */}
      <div>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{item.rawTitle}</span>
        {item.elementKey && item.elementKey !== item.rawTitle && (
          <p style={{ margin: 0, fontSize: 10, color: "var(--ink-55)" }}>
            {item.elementKey}
          </p>
        )}
      </div>

      {/* Status + action */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.12em",
            padding: "2px 7px",
            borderRadius: 999,
            background: cfg.chipBg,
            color: cfg.chipColor,
            whiteSpace: "nowrap",
          }}
        >
          {item.status === "incident" && item.incident
            ? item.incident.kind.replace(/_/g, " ").toUpperCase()
            : item.status === "good" && delta !== null
              ? `${cfg.label} ${delta > 0 ? "+" : ""}${formatDuration(delta)}`
              : cfg.label}
        </span>

        {item.status === "incident" && item.incident && (
          <IncidentActions
            incident={item.incident}
            redirectTo={redirectTo}
            onCorrect={onCorrect}
          />
        )}

        {(item.status === "rollup" || item.status === "unmapped") && (
          <MapActions
            item={item}
            redirectTo={redirectTo}
            availableElements={availableElements}
          />
        )}
      </div>
    </div>
  );
}

function IncidentActions({
  incident,
  redirectTo,
  onCorrect,
}: {
  incident: TriageItemIncident;
  redirectTo: string;
  onCorrect: (payload: CorrectModalPayload) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {incident.canCorrectItemTimes && (
        <button
          type="button"
          onClick={() =>
            onCorrect({
              incidentId: incident.id,
              kind: incident.kind,
              rawActualSeconds: incident.rawActualSeconds,
              plannedSeconds: incident.plannedSeconds,
              itemTimeId: incident.itemTimeId,
              redirectTo,
            })
          }
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            border: "none",
            background: "var(--accent)",
            color: "white",
            cursor: "pointer",
            letterSpacing: "0.1em",
          }}
        >
          Correct
        </button>
      )}
      <form action={resolveReviewIncidentAction} style={{ display: "inline" }}>
        <input type="hidden" name="incidentId" value={String(incident.id)} />
        <input type="hidden" name="resolution" value="kept" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button
          type="submit"
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid rgba(28,32,48,0.2)",
            background: "transparent",
            cursor: "pointer",
            color: "var(--ink-55)",
            letterSpacing: "0.1em",
          }}
        >
          Keep
        </button>
      </form>
      <form action={resolveReviewIncidentAction} style={{ display: "inline" }}>
        <input type="hidden" name="incidentId" value={String(incident.id)} />
        <input type="hidden" name="resolution" value="excluded" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button
          type="submit"
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid rgba(28,32,48,0.2)",
            background: "transparent",
            cursor: "pointer",
            color: "var(--ink-55)",
            letterSpacing: "0.1em",
          }}
        >
          Exclude
        </button>
      </form>
    </div>
  );
}


export default function TriageView({
  data,
  campus,
}: {
  data: TriageData;
  campus: string;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<CorrectModalPayload | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const closeModal = useCallback(() => setModal(null), []);
  const dismissToast = useCallback(() => setToast(null), []);

  function navigate(newCampus: string) {
    router.push(
      `/instrument/triage?campus=${newCampus}&date=latest`,
    );
  }

  const redirectTo = `/instrument/triage?campus=${campus}&date=${data.serviceDate}`;
  const goodCount = data.slots
    .flatMap((s) => s.sections.flatMap((sec) => sec.items))
    .filter((i) => i.status === "good").length;

  return (
    <main className="instrument-page">
      {/* Header */}
      <section style={{ marginBottom: "1.5rem" }}>
        <p className="instrument-eyebrow">Triage · service flow</p>
        <h1 className="instrument-title" style={{ fontSize: "clamp(1.8rem,3.5vw,3rem)", marginBottom: "0.5rem" }}>
          Resolve in the flow of the service.
        </h1>
        <p className="instrument-subtitle" style={{ marginTop: 0 }}>
          {data.totalAttentionCount > 0
            ? `${data.totalAttentionCount} item${data.totalAttentionCount === 1 ? "" : "s"} need attention, surfaced inline in service order below.`
            : "All items are clear."}{" "}
          {goodCount > 0 && `${goodCount} good to go.`}
        </p>
      </section>

      {/* Campus selector + plan label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {CAMPUS_CODES.map((code) => {
            const active = campus === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => navigate(code)}
                className={
                  active
                    ? "slot-picker__option slot-picker__option--active"
                    : "slot-picker__option"
                }
              >
                {code}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: "var(--ink-55)" }}>
          {data.campus.name} · {formatServiceDate(data.serviceDate)}
        </span>
        <span style={{ fontSize: 11, color: "var(--ink-35, rgba(28,32,48,0.35))" }}>
          {data.planTitle}
        </span>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
        }}
      >
        {[
          { label: "✓ GOOD", color: "var(--under)" },
          { label: "ROLL-UP?", color: "var(--amber-text)" },
          { label: "UNMAPPED", color: "var(--amber-text)" },
          { label: "INCIDENT", color: "var(--over)" },
          { label: "NOT TRACKED", color: "rgba(28,32,48,0.35)" },
        ].map((l) => (
          <span key={l.label} style={{ color: l.color }}>
            {l.label}
          </span>
        ))}
      </div>

      {/* Service-order panel */}
      <div className="glass-card" style={{ borderRadius: 14, overflow: "hidden" }}>
        {/* Column header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "74px 52px 1fr auto",
            gap: 8,
            padding: "10px 16px",
            borderBottom: "1px solid rgba(28,32,48,0.1)",
          }}
        >
          {["TIME", "LEN", "TITLE", "STATUS · ACTION"].map((h) => (
            <span
              key={h}
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--ink-55)",
              }}
            >
              {h}
            </span>
          ))}
        </div>

        {data.slots.length === 0 && (
          <div
            style={{
              padding: "32px 16px",
              textAlign: "center",
              color: "var(--ink-55)",
              fontSize: 13,
            }}
          >
            No production service slots found for this date.
          </div>
        )}

        {data.slots.map((slot) => {
          const cumulatives = buildCumulativeMap(slot.sections);
          return (
            <div key={slot.planTimeId}>
              <SlotHeaderRow slot={slot} redirectTo={redirectTo} />
              {slot.sections.map((section) => (
                <div key={section.sectionKey}>
                  <SectionHeaderRow section={section} />
                  {section.items.map((item) => (
                    <ItemRow
                      key={`${slot.planTimeId}:${item.id}`}
                      item={item}
                      cumulative={cumulatives.get(item.id) ?? 0}
                      redirectTo={redirectTo}
                      onCorrect={setModal}
                      availableElements={data.availableElements}
                    />
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <CorrectModal payload={modal} onClose={closeModal} />
      <Toast message={toast} onDismiss={dismissToast} />
    </main>
  );
}

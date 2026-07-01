"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  correctPlanTimeIncidentAction,
  mapItemToElementAction,
  reopenReviewIncidentAction,
  resolveReviewIncidentAction,
  resolveSlotResolutionIncidentAction,
  unmapItemAction,
} from "@/lib/operator/review-actions";
import type {
  AvailableElement,
  ServiceDateOption,
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
    chipColor: "var(--ink-35, var(--ink-disabled))",
    chipBg: "var(--ink-fill-muted)",
    label: "NOT TRACKED",
  },
  rolled_up: {
    borderColor: "transparent",
    bg: "transparent",
    chipColor: "var(--ink-35, var(--ink-disabled))",
    chipBg: "var(--ink-fill-muted)",
    label: "↳ ROLLED UP",
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
  return seconds < 0 ? `−${str}` : str;
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
        background: "var(--ink-fill-subtle)",
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
          <span style={{ fontSize: 11, color: "var(--ink-70)", marginLeft: 8 }}>
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
            fontSize: "var(--type-caption)",
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

  if (incident.canCorrectPlanTimeActual) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: "var(--type-micro)",
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
        <span style={{ fontSize: "var(--type-caption)", color: "var(--ink-70)", fontVariantNumeric: "tabular-nums" }}>
          {formatDuration(incident.rawActualSeconds)} actual /{" "}
          {formatDuration(incident.plannedSeconds)} plan
        </span>
        <form action={correctPlanTimeIncidentAction} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="hidden" name="incidentId" value={String(incident.id)} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input
            type="text"
            name="correctedActual"
            defaultValue={incident.rawActualSeconds !== null ? formatDuration(incident.rawActualSeconds) : ""}
            placeholder="75:30"
            style={{
              fontSize: "var(--type-caption)",
              padding: "2px 6px",
              borderRadius: 6,
              border: "1px solid var(--ink-border-control)",
              background: "rgba(255,255,255,0.7)",
              width: 60,
            }}
          />
          <button
            type="submit"
            style={{
              fontSize: "var(--type-micro)",
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              border: "none",
              background: "var(--accent)",
              color: "white",
              cursor: "pointer",
            }}
          >
            Save
          </button>
        </form>
      </div>
    );
  }

  if (incident.canResolveSlotResolution) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: "var(--type-micro)",
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
              fontSize: "var(--type-caption)",
              padding: "2px 6px",
              borderRadius: 6,
              border: "1px solid var(--ink-border-control)",
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
              fontSize: "var(--type-micro)",
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
              fontSize: "var(--type-micro)",
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              border: "1px solid var(--ink-border-control)",
              background: "transparent",
              cursor: "pointer",
              color: "var(--ink-70)",
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
          fontSize: "var(--type-micro)",
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
      <span style={{ fontSize: "var(--type-caption)", color: "var(--ink-70)", fontVariantNumeric: "tabular-nums" }}>
        {formatDuration(incident.rawActualSeconds)} actual /{" "}
        {formatDuration(incident.plannedSeconds)} plan
      </span>
    </div>
  );
}

function SectionHeaderRow({ section }: { section: TriageSection }) {
  const attentionItems = section.items.filter(
    (i) => i.status === "unmapped" || i.status === "incident",
  );
  const hasAttention = attentionItems.length > 0;

  return (
    <div
      className="triage-row"
      style={{
        padding: "8px 16px 6px",
        background: "var(--ink-fill-faint)",
        borderBottom: "1px solid var(--ink-line-soft)",
        borderTop: "1px solid var(--ink-line-soft)",
      }}
    >
      <span className="triage-row__time" />
      <span className="triage-row__len" />
      <span
        style={{
          fontSize: "var(--type-micro)",
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
          fontSize: "var(--type-micro)",
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
          fontSize: "var(--type-micro)",
          padding: "2px 4px",
          borderRadius: 6,
          border: "1px solid var(--ink-border-control)",
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
          fontSize: "var(--type-micro)",
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
  elementName,
}: {
  item: TriageItem;
  cumulative: number;
  redirectTo: string;
  onCorrect: (payload: CorrectModalPayload) => void;
  availableElements: AvailableElement[];
  elementName: Map<string, string>;
}) {
  const cfg = STATUS_CONFIG[item.status];
  const delta =
    item.actualSeconds !== null && item.plannedSeconds !== null
      ? item.actualSeconds - item.plannedSeconds
      : null;

  return (
    <div
      className="triage-row"
      style={{
        padding: "9px 16px",
        borderBottom: "1px solid var(--ink-fill-subtle)",
        borderLeft: `3px solid ${cfg.borderColor}`,
        background: cfg.bg,
      }}
    >
      {/* Cumulative time */}
      <span
        className="triage-row__time tabular"
        style={{ fontSize: "var(--type-caption)", color: "var(--ink-70)", fontWeight: 500 }}
      >
        {formatCumulative(cumulative)}
      </span>

      {/* Planned */}
      <span
        className="triage-row__len tabular"
        style={{ fontSize: 11, color: "var(--ink-70)" }}
      >
        {item.plannedSeconds !== null ? formatDuration(item.plannedSeconds) : "—"}
      </span>

      {/* Title */}
      <div>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{item.rawTitle}</span>
        {item.elementKey && item.elementKey !== item.rawTitle && (
          <p style={{ margin: 0, fontSize: "var(--type-caption)", color: "var(--ink-70)" }}>
            {elementName.get(item.elementKey) ?? item.elementKey}
          </p>
        )}
      </div>

      {/* Status + action */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span
          style={{
            fontSize: "var(--type-micro)",
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
            : item.status === "resolved" && item.resolutionLabel
              ? `✓ ${item.resolutionLabel}`
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

        {item.status === "resolved" && item.resolvedIncidentId && (
          <form action={reopenReviewIncidentAction} style={{ display: "inline" }}>
            <input type="hidden" name="incidentId" value={String(item.resolvedIncidentId)} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <button
              type="submit"
              style={{
                fontSize: "var(--type-micro)",
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid var(--ink-border-control)",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-70)",
                letterSpacing: "0.1em",
              }}
            >
              Undo
            </button>
          </form>
        )}

        {item.status === "unmapped" && (
          <MapActions
            item={item}
            redirectTo={redirectTo}
            availableElements={availableElements}
          />
        )}

        {item.hasOverride && (
          <form action={unmapItemAction} style={{ display: "inline" }}>
            <input type="hidden" name="itemId" value={String(item.id)} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <button
              type="submit"
              style={{
                fontSize: "var(--type-micro)",
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid var(--ink-border-control)",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-70)",
                letterSpacing: "0.1em",
              }}
            >
              Unmap
            </button>
          </form>
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
            fontSize: "var(--type-micro)",
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
            fontSize: "var(--type-micro)",
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid var(--ink-border-control)",
            background: "transparent",
            cursor: "pointer",
            color: "var(--ink-70)",
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
            fontSize: "var(--type-micro)",
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid var(--ink-border-control)",
            background: "transparent",
            cursor: "pointer",
            color: "var(--ink-70)",
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
  availableDates,
}: {
  data: TriageData;
  campus: string;
  availableDates: ServiceDateOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [modal, setModal] = useState<CorrectModalPayload | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const closeModal = useCallback(() => setModal(null), []);
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const msg = searchParams.get("toast");
    if (!msg) return;
    const id = setTimeout(() => setToast(msg), 0);
    router.replace(`/instrument/triage?campus=${campus}&date=${data.serviceDate}`);
    return () => clearTimeout(id);
  }, [searchParams, router, campus, data.serviceDate]);

  function navigate(newCampus: string) {
    router.push(`/instrument/triage?campus=${newCampus}&date=${data.serviceDate}`);
  }

  function navigateDate(serviceDate: string) {
    router.push(`/instrument/triage?campus=${campus}&date=${serviceDate}`);
  }

  const currentDateIdx = availableDates.findIndex((d) => d.serviceDate === data.serviceDate);
  const canPrev = currentDateIdx < availableDates.length - 1;
  const canNext = currentDateIdx > 0 && currentDateIdx !== -1;

  const elementName = new Map(data.availableElements.map((e) => [e.key, e.displayName]));

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

      {/* Campus selector + date picker + plan label */}
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

        {availableDates.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => navigateDate(availableDates[currentDateIdx + 1].serviceDate)}
              className="slot-picker__option"
              style={{ opacity: canPrev ? 1 : 0.3, cursor: canPrev ? "pointer" : "default" }}
              aria-label="Previous Sunday"
            >
              ‹
            </button>
            <select
              aria-label="Service date"
              value={data.serviceDate}
              onChange={(e) => navigateDate(e.target.value)}
              className="date-picker__select"
            >
              {availableDates.map((opt) => (
                <option key={opt.serviceDate} value={opt.serviceDate}>
                  {formatServiceDate(opt.serviceDate)}
                  {opt.attentionCount > 0 ? ` · ${opt.attentionCount}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => navigateDate(availableDates[currentDateIdx - 1].serviceDate)}
              className="slot-picker__option"
              style={{ opacity: canNext ? 1 : 0.3, cursor: canNext ? "pointer" : "default" }}
              aria-label="Next Sunday"
            >
              ›
            </button>
          </div>
        )}

        <span style={{ fontSize: 11, color: "var(--ink-35, var(--ink-disabled))" }}>
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
          fontSize: "var(--type-caption)",
          fontWeight: 700,
          letterSpacing: "0.12em",
        }}
      >
        {[
          { label: "✓ GOOD", color: "var(--under)" },
          { label: "↳ ROLLED UP", color: "var(--ink-disabled)" },
          { label: "UNMAPPED", color: "var(--amber-text)" },
          { label: "INCIDENT", color: "var(--over)" },
          { label: "NOT TRACKED", color: "var(--ink-disabled)" },
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
          className="triage-row"
          style={{ padding: "10px 16px", borderBottom: "1px solid var(--hairline)" }}
        >
          {(["TIME", "LEN", "TITLE", "STATUS · ACTION"] as const).map((h) => (
            <span
              key={h}
              className={h === "TIME" ? "triage-row__time" : h === "LEN" ? "triage-row__len" : undefined}
              style={{
                fontSize: "var(--type-micro)",
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--ink-70)",
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
              color: "var(--ink-70)",
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
                      elementName={elementName}
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

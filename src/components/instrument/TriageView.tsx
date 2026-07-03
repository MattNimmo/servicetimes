"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";

import {
  correctPlanTimeIncidentAction,
  mapItemToElementAction,
  reopenReviewIncidentAction,
  resolveReviewIncidentAction,
  resolveSlotResolutionIncidentAction,
  unmapItemAction,
  type InlineActionState,
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
    pillClass: "pill--under",
    label: "✓ MAPPED",
  },
  not_tracked: {
    borderColor: "transparent",
    bg: "transparent",
    pillClass: "pill--muted",
    label: "NOT TRACKED",
  },
  rolled_up: {
    borderColor: "transparent",
    bg: "transparent",
    pillClass: "pill--muted",
    label: "↳ ROLLED UP",
  },
  unmapped: {
    borderColor: "var(--unmapped)",
    bg: "var(--unmapped-fill)",
    pillClass: "pill--unmapped",
    label: "UNMAPPED",
  },
  incident: {
    borderColor: "var(--over)",
    bg: "rgba(207,82,44,0.04)",
    pillClass: "pill--over",
    label: "INCIDENT",
  },
  resolved: {
    borderColor: "transparent",
    bg: "transparent",
    pillClass: "pill--under",
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

// All campuses broadcast in Central time (see src/lib/pco/campuses.ts).
const CAMPUS_TIME_ZONE = "America/Chicago";

function formatClockParts(hours24: number, minutes: number): string {
  const suffix = hours24 >= 12 ? "p" : "a";
  const h = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${h}:${String(minutes).padStart(2, "0")}${suffix}`;
}

// PLAN clock: the slot's scheduled local start ("09:00:00") plus the item's
// cumulative planned offset — "24:00 into the 11am" renders as 11:24a.
function formatPlanClock(expectedLocalStart: string, offsetSeconds: number): string {
  const [h = 0, m = 0] = expectedLocalStart.split(":").map(Number);
  const total = (((h * 3600 + m * 60 + offsetSeconds) % 86400) + 86400) % 86400;
  return formatClockParts(Math.floor(total / 3600), Math.floor((total % 3600) / 60));
}

// ACTUAL clock: the wall-clock start PCO recorded for the item's timer.
function formatActualClock(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: CAMPUS_TIME_ZONE,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  return `${hour}:${minute}${period.toLowerCase().startsWith("p") ? "p" : "a"}`;
}

// For each open bundle_overlap incident, explain on the timed parent row what
// overlapped and — when both timers were recorded — whether the plan time was
// actually double-counted.
function buildOverlapHints(sections: TriageSection[]): Map<number, string> {
  const allItems = sections.flatMap((s) => s.items);
  const groups = new Map<number, TriageItem[]>();
  for (const item of allItems) {
    if (item.incident?.kind === "bundle_overlap") {
      groups.set(item.incident.id, [...(groups.get(item.incident.id) ?? []), item]);
    }
  }

  const hints = new Map<number, string>();
  for (const involved of groups.values()) {
    const parent = involved.find((i) => i.itemType !== "song") ?? involved[0];
    const children = involved.filter((i) => i !== parent);
    if (!parent || children.length === 0) continue;

    let verdict = "Compare the ACTUAL clocks on these rows to decide.";
    if (parent.liveStartAt && parent.liveEndAt) {
      const parentStart = Date.parse(parent.liveStartAt);
      const parentEnd = Date.parse(parent.liveEndAt);
      const timedChildren = children.filter((c) => c.liveStartAt && c.liveEndAt);
      if (timedChildren.length > 0) {
        const ranInside = timedChildren.every(
          (c) => Date.parse(c.liveStartAt!) >= parentStart && Date.parse(c.liveEndAt!) <= parentEnd,
        );
        const ranAfter = timedChildren.every((c) => Date.parse(c.liveStartAt!) >= parentEnd);
        if (ranInside) {
          verdict = "The songs ran inside this item's timer — plan time is double-counted. Correct or Exclude.";
        } else if (ranAfter) {
          verdict = "Timers ran back-to-back, not overlapping — likely fine. Keep.";
        }
      }
    }

    hints.set(
      parent.id,
      `Plan may double-count: this item (${formatDuration(parent.plannedSeconds)}) plus ${children.length} timed song${children.length === 1 ? "" : "s"} below it. ${verdict}`,
    );
  }
  return hints;
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
        <span className="pill pill--over">
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
            className="glass-input glass-input--compact"
            style={{ width: 60 }}
          />
          <button
            type="submit"
            className="btn btn--primary btn--compact"
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
        <span className="pill pill--over">
          {label}
        </span>
        <form action={resolveSlotResolutionIncidentAction} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="hidden" name="incidentId" value={String(incident.id)} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <select
            name="slotId"
            defaultValue=""
            className="glass-select"
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
            className="btn btn--primary btn--compact"
          >
            Map
          </button>
          <button
            type="submit"
            name="slotResolutionAction"
            value="exclude"
            className="btn btn--ghost btn--compact"
          >
            Exclude
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="pill pill--over">
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
      <span className="triage-row__time" />
      <span className="triage-row__len" />
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
      <span className={hasAttention ? "pill pill--review" : "pill pill--under"}>
        {hasAttention ? `${attentionItems.length} NEED ATTENTION` : "ALL CLEAR"}
      </span>
    </div>
  );
}

// Surfaces the returned message from a non-redirecting row action as a toast.
function useInlineToast(state: InlineActionState, onToast: (msg: string) => void) {
  useEffect(() => {
    if (state?.message) onToast(state.message);
  }, [state, onToast]);
}

const MAP_BUTTON_LABEL = {
  unmapped: "Map",
  good: "Re-map",
  rolled_up: "Un-roll",
} as const;

function MapActions({
  item,
  availableElements,
  variant,
  onToast,
}: {
  item: TriageItem;
  availableElements: AvailableElement[];
  variant: keyof typeof MAP_BUTTON_LABEL;
  onToast: (msg: string) => void;
}) {
  const [state, formAction, pending] = useActionState(mapItemToElementAction, null);
  useInlineToast(state, onToast);

  // Group elements by section for <optgroup>; availableElements arrive
  // pre-sorted in service-flow order (pre-service → worship → … → post).
  const groups = new Map<string, { label: string; elements: AvailableElement[] }>();
  for (const el of availableElements) {
    if (!groups.has(el.sectionKey)) {
      groups.set(el.sectionKey, { label: el.sectionLabel, elements: [] });
    }
    groups.get(el.sectionKey)!.elements.push(el);
  }

  return (
    <form action={formAction} style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input type="hidden" name="itemId" value={String(item.id)} />
      <select
        name="elementWithSection"
        defaultValue=""
        className="glass-select glass-select--compact"
      >
        <option value="" disabled>
          Map to…
        </option>
        {Array.from(groups.entries()).map(([sectionKey, group]) => (
          <optgroup key={sectionKey} label={group.label}>
            {group.elements.map((el) => (
              <option key={el.key} value={`${el.key}|${sectionKey}`}>
                {el.displayName}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className={variant === "unmapped" ? "btn btn--primary btn--compact" : "btn btn--ghost btn--compact"}
      >
        {MAP_BUTTON_LABEL[variant]}
      </button>
    </form>
  );
}

function UnmapForm({ itemId, onToast }: { itemId: number; onToast: (msg: string) => void }) {
  const [state, formAction, pending] = useActionState(unmapItemAction, null);
  useInlineToast(state, onToast);

  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="itemId" value={String(itemId)} />
      <button type="submit" disabled={pending} className="btn btn--ghost btn--compact">
        Unmap
      </button>
    </form>
  );
}

function ReopenForm({ incidentId, onToast }: { incidentId: number; onToast: (msg: string) => void }) {
  const [state, formAction, pending] = useActionState(reopenReviewIncidentAction, null);
  useInlineToast(state, onToast);

  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="incidentId" value={String(incidentId)} />
      <button type="submit" disabled={pending} className="btn btn--ghost btn--compact">
        Undo
      </button>
    </form>
  );
}

function ResolveForm({
  incidentId,
  resolution,
  onToast,
}: {
  incidentId: number;
  resolution: "kept" | "excluded";
  onToast: (msg: string) => void;
}) {
  const [state, formAction, pending] = useActionState(resolveReviewIncidentAction, null);
  useInlineToast(state, onToast);

  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="incidentId" value={String(incidentId)} />
      <input type="hidden" name="resolution" value={resolution} />
      <button type="submit" disabled={pending} className="btn btn--ghost btn--compact">
        {resolution === "kept" ? "Keep" : "Exclude"}
      </button>
    </form>
  );
}

function ItemRow({
  item,
  planClock,
  redirectTo,
  onCorrect,
  onToast,
  availableElements,
  elementName,
  overlapHint,
}: {
  item: TriageItem;
  planClock: string;
  redirectTo: string;
  onCorrect: (payload: CorrectModalPayload) => void;
  onToast: (msg: string) => void;
  availableElements: AvailableElement[];
  elementName: Map<string, string>;
  overlapHint?: string;
}) {
  const cfg = STATUS_CONFIG[item.status];
  const delta =
    item.actualSeconds !== null && item.plannedSeconds !== null
      ? item.actualSeconds - item.plannedSeconds
      : null;
  const actualClock = formatActualClock(item.liveStartAt);
  const actualLen = item.actualSeconds !== null ? formatDuration(item.actualSeconds) : null;

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
      {/* Plan clock (slot start + cumulative planned offset) */}
      <span
        className="triage-row__time tabular"
        style={{ fontSize: "var(--type-caption)", color: "var(--ink-70)", fontWeight: 500 }}
      >
        {planClock}
      </span>

      {/* Actual clock (recorded PCO timer start) */}
      <span
        className="triage-row__time tabular"
        style={{
          fontSize: "var(--type-caption)",
          color: actualClock ? "var(--ink)" : "var(--ink-disabled)",
          fontWeight: actualClock ? 600 : 500,
        }}
      >
        {actualClock ?? "—"}
      </span>

      {/* Planned length */}
      <span
        className="triage-row__len tabular"
        style={{ fontSize: 11, color: "var(--ink-70)" }}
      >
        {item.plannedSeconds !== null ? formatDuration(item.plannedSeconds) : "—"}
      </span>

      {/* Actual length */}
      <span
        className="triage-row__len tabular"
        style={{
          fontSize: 11,
          color:
            delta === null
              ? "var(--ink-disabled)"
              : delta > 0
                ? "var(--over)"
                : "var(--under)",
        }}
      >
        {actualLen ?? "—"}
      </span>

      {/* Title */}
      <div className="triage-row__title">
        <span style={{ fontSize: 12, fontWeight: 500 }}>{item.rawTitle}</span>
        <p className="triage-row__meta">
          <span>{planClock}</span>
          {actualClock && <span>{actualClock}</span>}
          <span>{item.plannedSeconds !== null ? formatDuration(item.plannedSeconds) : "—"}</span>
          {actualLen && <span>{actualLen}</span>}
        </p>
        {item.elementKey && item.elementKey !== item.rawTitle && (
          <p style={{ margin: 0, fontSize: "var(--type-caption)", color: "var(--ink-70)" }}>
            {elementName.get(item.elementKey) ?? item.elementKey}
          </p>
        )}
        {overlapHint && (
          <p style={{ margin: "3px 0 0", fontSize: "var(--type-caption)", color: "var(--over)", lineHeight: 1.4 }}>
            {overlapHint}
          </p>
        )}
      </div>

      {/* Status + action */}
      <div className="triage-row__actions">
        <span className={`pill ${cfg.pillClass}`}>
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
            onToast={onToast}
          />
        )}

        {item.status === "resolved" && item.resolvedIncidentId && (
          <ReopenForm incidentId={item.resolvedIncidentId} onToast={onToast} />
        )}

        {(item.status === "unmapped" ||
          item.status === "good" ||
          item.status === "rolled_up") && (
          <MapActions
            item={item}
            availableElements={availableElements}
            variant={item.status}
            onToast={onToast}
          />
        )}

        {item.hasOverride && <UnmapForm itemId={item.id} onToast={onToast} />}
      </div>
    </div>
  );
}

function IncidentActions({
  incident,
  redirectTo,
  onCorrect,
  onToast,
}: {
  incident: TriageItemIncident;
  redirectTo: string;
  onCorrect: (payload: CorrectModalPayload) => void;
  onToast: (msg: string) => void;
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
          className="btn btn--primary btn--compact"
        >
          Correct
        </button>
      )}
      <ResolveForm incidentId={incident.id} resolution="kept" onToast={onToast} />
      <ResolveForm incidentId={incident.id} resolution="excluded" onToast={onToast} />
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
  // Slot selected in the toggle; falls back to the first slot whenever the
  // campus/date changes and the remembered planTimeId no longer exists.
  const [selectedPlanTimeId, setSelectedPlanTimeId] = useState<number | null>(null);

  const closeModal = useCallback(() => setModal(null), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const showToast = useCallback((msg: string) => setToast(msg), []);

  useEffect(() => {
    const msg = searchParams.get("toast");
    if (!msg) return;
    const id = setTimeout(() => setToast(msg), 0);
    router.replace(`/instrument/triage?campus=${campus}&date=${data.serviceDate}`, {
      scroll: false,
    });
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

  const activeSlot =
    data.slots.find((s) => s.planTimeId === selectedPlanTimeId) ?? data.slots[0] ?? null;

  const slotAttentionCount = (slot: TriageSlot) =>
    slot.slotIncidents.length +
    slot.sections
      .flatMap((sec) => sec.items)
      .filter((i) => i.status === "unmapped" || i.status === "incident").length;

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
          <div className="inline-control-row">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => navigateDate(availableDates[currentDateIdx + 1].serviceDate)}
              className="slot-picker__option"
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
              aria-label="Next Sunday"
            >
              ›
            </button>
          </div>
        )}

        {data.slots.length > 1 && (
          <div className="slot-picker">
            {data.slots.map((slot) => {
              const attention = slotAttentionCount(slot);
              const active = slot.planTimeId === activeSlot?.planTimeId;
              return (
                <button
                  key={slot.planTimeId}
                  type="button"
                  onClick={() => setSelectedPlanTimeId(slot.planTimeId)}
                  className={
                    active
                      ? "slot-picker__option slot-picker__option--active"
                      : "slot-picker__option"
                  }
                >
                  {slot.slotLabel}
                  {attention > 0 ? ` · ${attention}` : ""}
                </button>
              );
            })}
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
          { label: "UNMAPPED", color: "var(--unmapped)" },
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
          {(
            [
              { label: "PLAN", className: "triage-row__time" },
              { label: "ACTUAL", className: "triage-row__time" },
              { label: "LEN", className: "triage-row__len" },
              { label: "ACT", className: "triage-row__len" },
              { label: "TITLE", className: undefined },
              { label: "STATUS · ACTION", className: undefined },
            ] as const
          ).map((h) => (
            <span
              key={h.label}
              className={h.className}
              style={{
                fontSize: "var(--type-micro)",
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--ink-70)",
              }}
            >
              {h.label}
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

        {activeSlot &&
          (() => {
            const cumulatives = buildCumulativeMap(activeSlot.sections);
            const overlapHints = buildOverlapHints(activeSlot.sections);
            const planClockFor = (itemId: number) => {
              const offset = cumulatives.get(itemId) ?? 0;
              return activeSlot.expectedLocalStart
                ? formatPlanClock(activeSlot.expectedLocalStart, offset)
                : formatCumulative(offset);
            };
            return (
              <div key={activeSlot.planTimeId}>
                <SlotHeaderRow slot={activeSlot} redirectTo={redirectTo} />
                {activeSlot.sections.map((section) => (
                  <div key={section.sectionKey}>
                    <SectionHeaderRow section={section} />
                    {section.items.map((item) => (
                      <ItemRow
                        key={`${activeSlot.planTimeId}:${item.id}`}
                        item={item}
                        planClock={planClockFor(item.id)}
                        redirectTo={redirectTo}
                        onCorrect={setModal}
                        onToast={showToast}
                        availableElements={data.availableElements}
                        elementName={elementName}
                        overlapHint={overlapHints.get(item.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
      </div>

      <CorrectModal payload={modal} onClose={closeModal} />
      <Toast message={toast} onDismiss={dismissToast} />
    </main>
  );
}

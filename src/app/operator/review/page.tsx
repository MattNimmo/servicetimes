import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import type { OpenReviewIncident } from "@/lib/operator/review-queries";
import {
  correctPlanTimeIncidentAction,
  correctItemTimeIncidentAction,
  resolveReviewIncidentAction,
  resolveSlotResolutionIncidentAction,
} from "@/lib/operator/review-actions";
import { listOpenReviewIncidents } from "@/lib/operator/review-queries";
import { formatDuration, formatServiceDate } from "@/lib/variance/format";

export const dynamic = "force-dynamic";

type ReviewPageProps = {
  searchParams: Promise<{
    campus?: string;
    date?: string;
    occurrence?: string;
  }>;
};

type OccurrenceGroup = {
  key: string;
  label: string;
  context: string;
  sortStamp: string;
  incidents: OpenReviewIncident[];
};

type DateGroup = {
  campusCode: string;
  campusName: string;
  serviceDate: string;
  label: string;
  incidents: OpenReviewIncident[];
  occurrences: OccurrenceGroup[];
};

function kindLabel(kind: string) {
  return kind.replaceAll("_", " ");
}

function formatTimeLabel(timestamp: string | null) {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function incidentTone(kind: string) {
  if (kind === "slot_resolution") {
    return "border-emerald-900/70 bg-emerald-950/20 text-emerald-300";
  }
  if (kind === "missing_item_end" || kind === "bundle_overlap") {
    return "border-violet-900/70 bg-violet-950/20 text-violet-300";
  }
  return "border-cyan-900/70 bg-cyan-950/20 text-cyan-300";
}

function occurrenceKey(incident: OpenReviewIncident) {
  return [
    incident.campusCode,
    incident.serviceDate,
    incident.planTimeName ?? incident.slotLabel ?? "unslotted",
    incident.planTimeStartsAt ?? incident.planTimeLiveStartsAt ?? incident.openedAt,
  ].join("::");
}

function occurrenceLabel(incident: OpenReviewIncident) {
  return incident.planTimeName ?? incident.slotLabel ?? "Review occurrence";
}

function occurrenceContext(incident: OpenReviewIncident) {
  const parts = [
    formatTimeLabel(incident.planTimeStartsAt),
    incident.slotLabel,
    incident.planTitle,
  ].filter(Boolean);
  return parts.join(" · ");
}

function servicePositionLabel(position: "pre" | "during" | "post" | null) {
  if (position === "pre") return "Pre service";
  if (position === "post") return "Post service";
  return "Live flow";
}

function uniqueKinds(incidents: OpenReviewIncident[]) {
  return [...new Set(incidents.map((incident) => incident.kind))];
}

function groupByServiceDate(incidents: OpenReviewIncident[]) {
  const grouped = new Map<string, DateGroup>();

  for (const incident of incidents) {
    const dateKey = `${incident.campusCode}::${incident.serviceDate}`;
    const existingDate = grouped.get(dateKey);
    if (!existingDate) {
      grouped.set(dateKey, {
        campusCode: incident.campusCode,
        campusName: incident.campusName,
        serviceDate: incident.serviceDate,
        label: `${incident.campusCode} · ${formatServiceDate(incident.serviceDate)}`,
        incidents: [incident],
        occurrences: [],
      });
      continue;
    }
    existingDate.incidents.push(incident);
  }

  const dates = [...grouped.values()].sort((left, right) =>
    `${left.serviceDate}:${left.campusCode}`.localeCompare(
      `${right.serviceDate}:${right.campusCode}`,
    ),
  );

  for (const date of dates) {
    const occurrenceMap = new Map<string, OccurrenceGroup>();
    for (const incident of date.incidents) {
      const key = occurrenceKey(incident);
      const existingOccurrence = occurrenceMap.get(key);
      if (!existingOccurrence) {
        occurrenceMap.set(key, {
          key,
          label: occurrenceLabel(incident),
          context: occurrenceContext(incident),
          sortStamp:
            incident.planTimeStartsAt ?? incident.planTimeLiveStartsAt ?? incident.openedAt,
          incidents: [incident],
        });
        continue;
      }
      existingOccurrence.incidents.push(incident);
    }

    date.occurrences = [...occurrenceMap.values()].sort((left, right) =>
      left.sortStamp.localeCompare(right.sortStamp),
    );
  }

  return dates.sort((left, right) =>
    `${right.serviceDate}:${left.campusCode}`.localeCompare(
      `${left.serviceDate}:${right.campusCode}`,
    ),
  );
}

function EvidencePreview({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).slice(0, 6);
  if (entries.length === 0) return null;
  return (
    <details className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/70">
      <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
        Details
      </summary>
      <dl className="grid gap-2 border-t border-zinc-800 px-4 py-4 text-xs text-zinc-500 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <dt className="font-mono uppercase">{key}</dt>
            <dd className="mt-1 break-words text-zinc-300">
              {typeof value === "string" || typeof value === "number"
                ? value
                : JSON.stringify(value)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ReviewActions({ incident, redirectTo }: { incident: OpenReviewIncident; redirectTo: string }) {
  return (
    <div className="mt-5 flex flex-wrap gap-3">
      <form action={resolveReviewIncidentAction}>
        <input type="hidden" name="incidentId" value={incident.id} />
        <input type="hidden" name="resolution" value="kept" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button
          type="submit"
          className="rounded-md border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/50"
        >
          Mark kept
        </button>
      </form>
      <form action={resolveReviewIncidentAction}>
        <input type="hidden" name="incidentId" value={incident.id} />
        <input type="hidden" name="resolution" value="excluded" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button
          type="submit"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
        >
          Exclude incident
        </button>
      </form>
    </div>
  );
}

function IncidentPanel({
  incident,
  redirectTo,
}: {
  incident: OpenReviewIncident;
  redirectTo: string;
}) {
  return (
    <article className="border-b border-zinc-800/80 py-6 last:border-b-0">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide uppercase ${incidentTone(incident.kind)}`}
            >
              {kindLabel(incident.kind)}
            </span>
            <span className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
              #{incident.id}
            </span>
          </div>
          <p className="mt-3 text-base text-zinc-200">{incident.detail}</p>
          {(incident.slotLabel || incident.planTimeName) && (
            <p className="mt-2 text-sm text-zinc-500">
              {[incident.slotLabel, incident.planTimeName].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <Link
          href={`/variance/${incident.campusCode}/${incident.serviceDate}`}
          className="text-sm text-cyan-300 hover:text-cyan-200"
        >
          Open dashboard →
        </Link>
      </div>

      {incident.items.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/60">
          <div className="grid grid-cols-[minmax(0,1.4fr)_10rem_10rem] gap-3 border-b border-zinc-800 px-4 py-3 font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
            <span>Review items</span>
            <span>Planned</span>
            <span>Current</span>
          </div>
          <ul className="divide-y divide-zinc-800">
            {incident.items.map((item) => (
              <li
                key={`${incident.id}:${item.id}:${item.itemTimeId ?? "plain"}`}
                className="grid grid-cols-[minmax(0,1.4fr)_10rem_10rem] gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-100">{item.title}</p>
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    {item.elementKey ?? item.sectionKey ?? "unmapped"}
                  </p>
                </div>
                <span className="text-zinc-300">
                  {formatDuration(item.plannedSeconds)}
                </span>
                <span className="text-zinc-400">
                  {item.actualSeconds !== null
                    ? formatDuration(item.actualSeconds)
                    : "needs review"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {incident.canCorrectPlanTimeActual && (
        <div className="mt-5 rounded-md border border-cyan-900/70 bg-cyan-950/20 p-4">
          <p className="font-mono text-[11px] tracking-[0.18em] text-cyan-300 uppercase">
            Correct slot actual
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Planned {formatDuration(incident.plannedTargetSeconds)} · Current actual{" "}
            {formatDuration(incident.actualServiceSeconds)}
          </p>
          <form
            action={correctPlanTimeIncidentAction}
            className="mt-4 flex flex-col gap-3 sm:flex-row"
          >
            <input type="hidden" name="incidentId" value={incident.id} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input
              type="text"
              name="correctedActual"
              defaultValue={
                incident.actualServiceSeconds !== null
                  ? formatDuration(incident.actualServiceSeconds)
                  : ""
              }
              placeholder="75:30"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-cyan-500 sm:max-w-[10rem]"
            />
            <button
              type="submit"
              className="rounded-md border border-cyan-800 bg-cyan-950/50 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-900/50"
            >
              Save corrected actual
            </button>
          </form>
        </div>
      )}

      {incident.canResolveSlotResolution && (
        <div className="mt-5 rounded-md border border-emerald-900/70 bg-emerald-950/20 p-4">
          <p className="font-mono text-[11px] tracking-[0.18em] text-emerald-300 uppercase">
            Resolve slot mapping
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Keep this occurrence out of variance, or map it into a production slot when it truly belongs there.
          </p>
          <form
            action={resolveSlotResolutionIncidentAction}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <input type="hidden" name="incidentId" value={incident.id} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="slotResolutionAction" value="map" />
            <select
              name="slotId"
              defaultValue=""
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500 sm:max-w-[14rem]"
            >
              <option value="" disabled>
                Choose slot
              </option>
              {incident.availableSlots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label} · {slot.expectedLocalStart}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/50"
            >
              Map to slot
            </button>
          </form>
          <form action={resolveSlotResolutionIncidentAction} className="mt-3">
            <input type="hidden" name="incidentId" value={incident.id} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="slotResolutionAction" value="exclude" />
            <button
              type="submit"
              className="rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
            >
              Exclude PlanTime from variance
            </button>
          </form>
        </div>
      )}

      {incident.canCorrectItemTimes &&
        incident.items.some((item) => item.itemTimeId !== null) && (
          <div className="mt-5 rounded-md border border-violet-900/70 bg-violet-950/20 p-4">
            <p className="font-mono text-[11px] tracking-[0.18em] text-violet-300 uppercase">
              Correct item actuals
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              Save corrected durations where the flagged items sit in this occurrence.
            </p>
            <form action={correctItemTimeIncidentAction} className="mt-4 space-y-3">
              <input type="hidden" name="incidentId" value={incident.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              {incident.items
                .filter((item) => item.itemTimeId !== null)
                .map((item) => (
                  <div
                    key={`${incident.id}:${item.id}:${item.itemTimeId}`}
                    className="grid gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-4 sm:grid-cols-[minmax(0,1fr)_11rem]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-100">{item.title}</p>
                      <p className="mt-1 truncate text-sm text-zinc-500">
                        {item.elementKey ?? item.sectionKey ?? "unmapped"}
                        {item.plannedSeconds !== null
                          ? ` · ${formatDuration(item.plannedSeconds)} planned`
                          : ""}
                        {item.actualSeconds !== null
                          ? ` · ${formatDuration(item.actualSeconds)} current actual`
                          : " · no current actual"}
                      </p>
                    </div>
                    <input
                      type="text"
                      name={`itemTime:${item.itemTimeId}`}
                      defaultValue={
                        item.actualSeconds !== null ? formatDuration(item.actualSeconds) : ""
                      }
                      placeholder="4:30"
                      className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-500"
                    />
                  </div>
                ))}
              <button
                type="submit"
                className="rounded-md border border-violet-800 bg-violet-950/50 px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-900/50"
              >
                Save corrected item actuals
              </button>
            </form>
          </div>
        )}

      <EvidencePreview evidence={incident.evidence} />
      <ReviewActions incident={incident} redirectTo={redirectTo} />
    </article>
  );
}

export default async function OperatorReviewPage({ searchParams }: ReviewPageProps) {
  await requireRole("operator");
  const incidents = await listOpenReviewIncidents();
  const filters = await searchParams;
  const dateGroups = groupByServiceDate(incidents);

  const selectedDate =
    dateGroups.find(
      (group) =>
        group.serviceDate === filters.date &&
        group.campusCode === (filters.campus?.toUpperCase() ?? filters.campus),
    ) ?? dateGroups[0] ?? null;

  const selectedOccurrence =
    selectedDate?.occurrences.find((occurrence) => occurrence.key === filters.occurrence) ??
    selectedDate?.occurrences[0] ??
    null;

  const selectedRedirect =
    selectedDate && selectedOccurrence
      ? `/operator/review?campus=${selectedDate.campusCode}&date=${selectedDate.serviceDate}&occurrence=${encodeURIComponent(selectedOccurrence.key)}`
      : "/operator/review";
  const selectedOccurrenceItems = selectedOccurrence?.incidents[0]?.occurrenceItems ?? [];
  const selectedOccurrenceKinds = uniqueKinds(selectedOccurrence?.incidents ?? []);
  const highlightedItemIds = new Set(
    selectedOccurrence?.incidents.flatMap((incident) => incident.items.map((item) => item.id)) ?? [],
  );
  const issueKindsByItemId = new Map<number, string[]>();
  for (const incident of selectedOccurrence?.incidents ?? []) {
    for (const item of incident.items) {
      const kinds = issueKindsByItemId.get(item.id) ?? [];
      if (!kinds.includes(incident.kind)) kinds.push(incident.kind);
      issueKindsByItemId.set(item.id, kinds);
    }
  }

  return (
    <main className="min-h-screen bg-[#121210] text-zinc-100">
      <div className="border-b border-zinc-800 bg-[#1b1f17]">
        <div className="mx-auto flex w-full max-w-[1500px] items-end justify-between gap-6 px-6 py-6 sm:px-8">
          <div>
            <p className="font-mono text-[11px] tracking-[0.22em] text-lime-300 uppercase">
              Operator · service review
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
              Service timing workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400 sm:text-base">
              Review timing issues where they happen in the service, not as detached cards.
            </p>
          </div>
          <div className="rounded-md border border-lime-900/60 bg-lime-950/20 px-4 py-3">
            <span className="block font-mono text-[11px] tracking-[0.18em] text-lime-300 uppercase">
              Open review
            </span>
            <strong className="mt-1 block text-2xl text-lime-100">{incidents.length}</strong>
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1500px] gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-r border-zinc-800 bg-[#171816]">
          <div className="border-b border-zinc-800 px-6 py-5">
            <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
              Service dates
            </p>
          </div>
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto">
            {dateGroups.map((group) => {
              const isSelectedDate =
                selectedDate?.serviceDate === group.serviceDate &&
                selectedDate.campusCode === group.campusCode;
              return (
                <section key={`${group.campusCode}:${group.serviceDate}`} className="border-b border-zinc-800">
                  <Link
                    href={`/operator/review?campus=${group.campusCode}&date=${group.serviceDate}`}
                    className={`block px-6 py-4 ${
                      isSelectedDate ? "bg-zinc-900/70" : "hover:bg-zinc-900/40"
                    }`}
                  >
                    <p className="font-medium text-zinc-100">{group.label}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {group.occurrences.length} occurrences · {group.incidents.length} issues
                    </p>
                  </Link>
                  {isSelectedDate && (
                    <div className="border-t border-zinc-800 bg-zinc-950/40">
                      {group.occurrences.map((occurrence) => {
                        const isSelectedOccurrence =
                          selectedOccurrence?.key === occurrence.key;
                        return (
                          <Link
                            key={occurrence.key}
                            href={`/operator/review?campus=${group.campusCode}&date=${group.serviceDate}&occurrence=${encodeURIComponent(occurrence.key)}`}
                            className={`block border-b border-zinc-800 px-6 py-4 last:border-b-0 ${
                              isSelectedOccurrence
                                ? "bg-zinc-900 text-zinc-50"
                                : "text-zinc-300 hover:bg-zinc-900/60"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{occurrence.label}</p>
                                <p className="mt-1 truncate text-sm text-zinc-500">
                                  {occurrence.context || "Review occurrence"}
                                </p>
                              </div>
                              <span className="rounded-full border border-amber-800/70 bg-amber-950/40 px-2 py-0.5 font-mono text-[11px] text-amber-300">
                                {occurrence.incidents.length}
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 bg-[#121210]">
          {!selectedDate || !selectedOccurrence ? (
            <div className="px-8 py-16">
              <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-10 text-center">
                <h2 className="text-2xl font-semibold">Review queue is clear.</h2>
                <p className="mt-2 text-zinc-500">
                  Fresh ingestion can add new issues here after the next run.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-zinc-800 bg-[#181816] px-8 py-6">
                <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                  {selectedDate.campusCode} · {formatServiceDate(selectedDate.serviceDate)}
                </p>
                  <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <h2 className="text-3xl font-semibold tracking-tight text-zinc-50">
                        {selectedOccurrence.label}
                      </h2>
                      <p className="mt-2 text-zinc-400">{selectedOccurrence.context}</p>
                      {selectedOccurrenceKinds.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {selectedOccurrenceKinds.map((kind) => (
                            <span
                              key={kind}
                              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide uppercase ${incidentTone(kind)}`}
                            >
                              {kindLabel(kind)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3">
                    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                      <span className="block font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                        Issues
                      </span>
                      <strong className="mt-1 block text-xl text-zinc-100">
                        {selectedOccurrence.incidents.length}
                      </strong>
                    </div>
                    <Link
                      href={`/variance/${selectedDate.campusCode}/${selectedDate.serviceDate}`}
                      className="rounded-md border border-cyan-800 bg-cyan-950/30 px-4 py-3 text-sm font-medium text-cyan-200 hover:bg-cyan-900/40"
                    >
                      Open variance dashboard
                    </Link>
                  </div>
                </div>
              </div>

              <div className="px-8 py-8">
                <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/40">
                  <div className="grid grid-cols-[11rem_minmax(0,1fr)_8rem] gap-4 border-b border-zinc-800 px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                    <span>Service time</span>
                    <span>Review focus</span>
                    <span>Issues</span>
                  </div>
                  <div className="grid grid-cols-[11rem_minmax(0,1fr)_8rem] gap-4 px-5 py-4 text-sm">
                    <span className="text-zinc-300">
                      {formatTimeLabel(selectedOccurrence.incidents[0]?.planTimeStartsAt) ??
                        "Unscheduled"}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-100">{selectedOccurrence.label}</p>
                      <p className="mt-1 text-zinc-500">{selectedOccurrence.context}</p>
                    </div>
                    <span className="text-amber-300">
                      {selectedOccurrence.incidents.length} open
                    </span>
                  </div>
                </div>

              <div className="mt-6 rounded-md border border-zinc-800 bg-zinc-900/40 px-6">
                  {selectedOccurrence.incidents.map((incident) => (
                    <IncidentPanel
                      key={incident.id}
                      incident={incident}
                      redirectTo={selectedRedirect}
                    />
                  ))}
                </div>

                {selectedOccurrenceItems.length > 0 && (
                  <div className="mt-6 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/40">
                    <div className="grid grid-cols-[4.5rem_minmax(0,1.4fr)_8rem_8rem_minmax(0,1fr)] gap-3 border-b border-zinc-800 px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                      <span>Order</span>
                      <span>Service flow</span>
                      <span>Planned</span>
                      <span>Current</span>
                      <span>Review focus</span>
                    </div>
                    <ul className="divide-y divide-zinc-800">
                      {selectedOccurrenceItems.map((item, index) => {
                        const highlighted = highlightedItemIds.has(item.id);
                        const rowKinds = issueKindsByItemId.get(item.id) ?? [];
                        const nextPosition = selectedOccurrenceItems[index - 1]?.servicePosition;
                        const showPositionBreak =
                          item.itemType !== "header" && item.servicePosition !== nextPosition;
                        return (
                          <li key={`occurrence-item:${item.id}`}>
                            {showPositionBreak && (
                              <div className="border-b border-zinc-800 bg-zinc-950/70 px-5 py-2 font-mono text-[11px] tracking-[0.18em] text-zinc-500 uppercase">
                                {servicePositionLabel(item.servicePosition)}
                              </div>
                            )}
                            {item.itemType === "header" ? (
                              <div className="grid grid-cols-[4.5rem_minmax(0,1.4fr)_8rem_8rem_minmax(0,1fr)] gap-3 bg-zinc-950/70 px-5 py-3">
                                <span className="text-zinc-500">{item.sequence}</span>
                                <span className="font-mono text-sm tracking-[0.18em] text-zinc-300 uppercase">
                                  {item.title}
                                </span>
                                <span />
                                <span />
                                <span />
                              </div>
                            ) : (
                              <div
                                className={`grid grid-cols-[4.5rem_minmax(0,1.4fr)_8rem_8rem_minmax(0,1fr)] gap-3 px-5 py-4 text-sm ${
                                  highlighted ? "bg-amber-950/15" : ""
                                }`}
                              >
                                <span className="text-zinc-500">{item.sequence}</span>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-zinc-100">
                                    {item.title}
                                  </p>
                                  <p className="mt-1 truncate text-xs text-zinc-500">
                                    {item.elementKey ?? item.sectionKey ?? "unmapped"}
                                  </p>
                                </div>
                                <span className="text-zinc-300">
                                  {formatDuration(item.plannedSeconds)}
                                </span>
                                <span className="text-zinc-400">
                                  {item.actualSeconds !== null
                                    ? formatDuration(item.actualSeconds)
                                    : "not timed"}
                                </span>
                                <div className="min-w-0">
                                  {rowKinds.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                      {rowKinds.map((kind) => (
                                        <span
                                          key={`${item.id}:${kind}`}
                                          className={`rounded-full border px-2 py-1 font-mono text-[11px] uppercase ${incidentTone(kind)}`}
                                        >
                                          {kindLabel(kind)}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="font-mono text-[11px] text-zinc-600 uppercase">
                                      clear
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

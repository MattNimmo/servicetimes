import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { resolveReviewIncidentAction } from "@/lib/operator/review-actions";
import { listOpenReviewIncidents } from "@/lib/operator/review-queries";
import { formatDuration, formatServiceDate } from "@/lib/variance/format";

export const dynamic = "force-dynamic";

function kindLabel(kind: string) {
  return kind.replaceAll("_", " ");
}

function EvidencePreview({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).slice(0, 4);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-4 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <dt className="font-mono uppercase">{key}</dt>
          <dd className="mt-1 truncate text-zinc-300">
            {typeof value === "string" || typeof value === "number"
              ? value
              : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function OperatorReviewPage() {
  await requireRole("operator");
  const incidents = await listOpenReviewIncidents();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-cyan-400 uppercase">
            Operator · review queue
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Open timing incidents
          </h1>
          <p className="mt-2 max-w-2xl text-zinc-500">
            Resolve review evidence only after a human decision. Kept means the
            source timing is acceptable as-is; excluded removes the incident
            from the active review queue without changing PCO.
          </p>
        </div>
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/30 px-4 py-3">
          <span className="block font-mono text-xs text-amber-300 uppercase">
            Open
          </span>
          <strong className="mt-1 block text-2xl text-amber-100">
            {incidents.length}
          </strong>
        </div>
      </div>

      <section className="mt-10 space-y-5">
        {incidents.map((incident) => (
          <article
            key={incident.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-800/70 bg-amber-950/40 px-2.5 py-1 font-mono text-[11px] tracking-wide text-amber-300 uppercase">
                    {kindLabel(incident.kind)}
                  </span>
                  <span className="font-mono text-xs text-zinc-500 uppercase">
                    #{incident.id}
                  </span>
                </div>
                <h2 className="mt-4 text-2xl font-semibold">
                  {incident.campusCode} · {formatServiceDate(incident.serviceDate)}
                </h2>
                <p className="mt-1 text-zinc-500">
                  {incident.planTitle}
                  {incident.slotLabel ? ` · ${incident.slotLabel}` : ""}
                  {incident.planTimeName ? ` · ${incident.planTimeName}` : ""}
                </p>
                {incident.detail && (
                  <p className="mt-4 max-w-3xl text-zinc-300">{incident.detail}</p>
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
              <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/50">
                <div className="border-b border-zinc-800 px-4 py-3 font-mono text-xs text-zinc-500 uppercase">
                  Affected items ({incident.itemCount})
                </div>
                <ul className="divide-y divide-zinc-800">
                  {incident.items.slice(0, 6).map((item) => (
                    <li key={item.id} className="px-4 py-3 text-sm">
                      <span className="font-medium text-zinc-100">{item.title}</span>
                      <span className="ml-2 text-zinc-500">
                        {item.elementKey ?? item.sectionKey ?? "unmapped"}
                        {item.plannedSeconds !== null
                          ? ` · ${formatDuration(item.plannedSeconds)} planned`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <EvidencePreview evidence={incident.evidence} />

            <div className="mt-6 flex flex-wrap gap-3">
              <form action={resolveReviewIncidentAction}>
                <input type="hidden" name="incidentId" value={incident.id} />
                <input type="hidden" name="resolution" value="kept" />
                <input type="hidden" name="redirectTo" value="/operator/review" />
                <button
                  type="submit"
                  className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/50"
                >
                  Mark kept
                </button>
              </form>
              <form action={resolveReviewIncidentAction}>
                <input type="hidden" name="incidentId" value={incident.id} />
                <input type="hidden" name="resolution" value="excluded" />
                <input type="hidden" name="redirectTo" value="/operator/review" />
                <button
                  type="submit"
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
                >
                  Exclude incident
                </button>
              </form>
            </div>
          </article>
        ))}

        {incidents.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-10 text-center">
            <h2 className="text-2xl font-semibold">Review queue is clear.</h2>
            <p className="mt-2 text-zinc-500">
              Nice. Fresh ingestion can add new incidents here after the next run.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

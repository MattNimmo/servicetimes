import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatDelta,
  formatDuration,
  formatPercent,
  formatServiceDate,
} from "@/lib/variance/format";
import { getVarianceDashboard } from "@/lib/variance/queries";

function ReviewPill({ label = "Needs review" }: { label?: string }) {
  return (
    <span className="inline-flex rounded-full border border-amber-800/70 bg-amber-950/40 px-2.5 py-1 font-mono text-[11px] tracking-wide text-amber-300 uppercase">
      {label}
    </span>
  );
}

export default async function ServiceVariancePage({
  params,
}: {
  params: Promise<{ campus: string; serviceDate: string }>;
}) {
  const { campus: code, serviceDate } = await params;
  const result = await getVarianceDashboard(code, serviceDate);
  if (!result || !result.plan) notFound();

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:px-10">
      <Link
        href={`/variance/${result.campus.code}`}
        className="text-sm text-zinc-500 hover:text-cyan-300"
      >
        ← {result.campus.name}
      </Link>
      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-cyan-400 uppercase">
            {result.campus.code} · Plan vs actual
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            {formatServiceDate(result.plan.service_date)}
          </h1>
          <p className="mt-2 text-zinc-500">
            {result.plan.title ?? result.plan.series_title ?? "Weekend service"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border border-amber-900/70 bg-amber-950/30 px-4 py-3">
            <span className="block font-mono text-xs text-amber-300 uppercase">
              Open review
            </span>
            <strong className="mt-1 block text-2xl text-amber-100">
              {result.openIncidentCount}
            </strong>
          </div>
          <div className="rounded-lg border border-violet-900/70 bg-violet-950/30 px-4 py-3">
            <span className="block font-mono text-xs text-violet-300 uppercase">
              Unmapped
            </span>
            <strong className="mt-1 block text-2xl text-violet-100">
              {result.unmappedCount}
            </strong>
          </div>
        </div>
      </div>

      <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.slots.map((slot) => (
          <article key={slot.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold">{slot.slotLabel}</h2>
              {slot.variance.status === "needs_review" && <ReviewPill />}
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <dt className="font-mono text-xs text-zinc-500 uppercase">Planned</dt>
                <dd className="mt-1 text-xl text-zinc-100">
                  {formatDuration(slot.variance.plannedSeconds)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-xs text-zinc-500 uppercase">Actual</dt>
                <dd className="mt-1 text-xl text-zinc-100">
                  {slot.variance.status === "complete"
                    ? formatDuration(slot.variance.actualSeconds)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-xs text-zinc-500 uppercase">Delta</dt>
                <dd className="mt-1 text-lg text-zinc-300">
                  {formatDelta(slot.variance.deltaSeconds)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-xs text-zinc-500 uppercase">Percent</dt>
                <dd className="mt-1 text-lg text-zinc-300">
                  {formatPercent(slot.variance.deltaPercent)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </section>

      <section className="mt-12">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-zinc-500 uppercase">
            Element detail
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Service flow</h2>
        </div>

        {result.slots.map((slot) => {
          const rows = result.elements.filter(
            ({ effective_slot_id }) => effective_slot_id === slot.effective_slot_id,
          );
          return (
            <div key={slot.id} className="mt-8 overflow-hidden rounded-xl border border-zinc-800">
              <div className="border-b border-zinc-800 bg-zinc-900 px-5 py-4">
                <h3 className="font-semibold">{slot.slotLabel}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-zinc-950 font-mono text-xs text-zinc-500 uppercase">
                    <tr>
                      <th className="px-5 py-3 font-medium">Section</th>
                      <th className="px-5 py-3 font-medium">Element</th>
                      <th className="px-5 py-3 font-medium">Planned</th>
                      <th className="px-5 py-3 font-medium">Actual</th>
                      <th className="px-5 py-3 font-medium">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 bg-zinc-900/30">
                    {rows.map((row) => (
                      <tr key={`${row.plan_time_id}:${row.element_key}`}>
                        <td className="px-5 py-4 text-zinc-500">{row.section_name}</td>
                        <td className="px-5 py-4 font-medium text-zinc-100">
                          {row.element_name}
                        </td>
                        <td className="px-5 py-4 tabular-nums text-zinc-300">
                          {formatDuration(row.variance.plannedSeconds)}
                        </td>
                        <td className="px-5 py-4 tabular-nums text-zinc-300">
                          {row.variance.status === "complete" ? (
                            formatDuration(row.variance.actualSeconds)
                          ) : (
                            <ReviewPill />
                          )}
                        </td>
                        <td className="px-5 py-4 tabular-nums text-zinc-300">
                          {formatDelta(row.variance.deltaSeconds)}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-zinc-500">
                          No mapped timing elements for this slot.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}

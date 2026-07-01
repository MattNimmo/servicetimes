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
    <span className="pill pill--review">
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
    <main className="app-page">
      <Link
        href={`/variance/${result.campus.code}`}
        className="app-link text-sm"
      >
        ← {result.campus.name}
      </Link>
      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="instrument-eyebrow">
            {result.campus.code} · Plan vs actual
          </p>
          <h1 className="instrument-title">
            {formatServiceDate(result.plan.service_date)}
          </h1>
          <p className="muted mt-2">
            {result.plan.title ?? result.plan.series_title ?? "Weekend service"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="metric-card">
            <span className="metric-card__label">
              Open review
            </span>
            <strong className="metric-card__value text-[var(--review)]">
              {result.openIncidentCount}
            </strong>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">
              Unmapped
            </span>
            <strong className="metric-card__value text-[var(--unmapped)]">
              {result.unmappedCount}
            </strong>
          </div>
        </div>
      </div>

      <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.slots.map((slot) => (
          <article key={slot.id} className="glass-tile">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold">{slot.slotLabel}</h2>
              {slot.variance.status === "needs_review" && <ReviewPill />}
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <dt className="table-label">Planned</dt>
                <dd className="mt-1 text-xl">
                  {formatDuration(slot.variance.plannedSeconds)}
                </dd>
              </div>
              <div>
                <dt className="table-label">Actual</dt>
                <dd className="mt-1 text-xl">
                  {slot.variance.status === "complete"
                    ? formatDuration(slot.variance.actualSeconds)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="table-label">Delta</dt>
                <dd className="muted mt-1 text-lg">
                  {formatDelta(slot.variance.deltaSeconds)}
                </dd>
              </div>
              <div>
                <dt className="table-label">Percent</dt>
                <dd className="muted mt-1 text-lg">
                  {formatPercent(slot.variance.deltaPercent)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </section>

      <section className="mt-12">
        <div>
          <p className="table-label">
            Element detail
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Service flow</h2>
        </div>

        {result.slots.map((slot) => {
          const rows = result.elements.filter(
            ({ effective_slot_id }) => effective_slot_id === slot.effective_slot_id,
          );
          return (
            <div key={slot.id} className="data-table-wrap glass-card mt-8">
              <div className="border-b border-[var(--hairline)] bg-white/50 px-5 py-4">
                <h3 className="font-semibold">{slot.slotLabel}</h3>
              </div>
              <div className="data-table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Element</th>
                      <th>Planned</th>
                      <th>Actual</th>
                      <th>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.plan_time_id}:${row.element_key}`}>
                        <td className="muted">{row.section_name}</td>
                        <td className="font-medium">
                          {row.element_name}
                        </td>
                        <td className="tabular-nums">
                          {formatDuration(row.variance.plannedSeconds)}
                        </td>
                        <td className="tabular-nums">
                          {row.variance.status === "complete" ? (
                            formatDuration(row.variance.actualSeconds)
                          ) : (
                            <ReviewPill />
                          )}
                        </td>
                        <td className="tabular-nums">
                          {formatDelta(row.variance.deltaSeconds)}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted py-8 text-center">
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

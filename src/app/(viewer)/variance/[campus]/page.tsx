import Link from "next/link";
import { notFound } from "next/navigation";

import { formatServiceDate } from "@/lib/variance/format";
import { listServiceDates } from "@/lib/variance/queries";

export default async function CampusVariancePage({
  params,
}: {
  params: Promise<{ campus: string }>;
}) {
  const { campus: code } = await params;
  const result = await listServiceDates(code);
  if (!result) notFound();

  return (
    <main className="app-page app-page--narrow">
      <Link href="/variance" className="app-link text-sm">
        ← All campuses
      </Link>
      <p className="instrument-eyebrow mt-8">
        {result.campus.code}
      </p>
      <h1 className="instrument-title">{result.campus.name}</h1>

      <div className="mt-10 space-y-4">
        {result.dates.length === 0 && (
          <p className="glass-tile muted">
            No ingested service dates yet.
          </p>
        )}
        {result.dates.map((plan) => (
          <Link
            key={plan.id}
            href={`/variance/${result.campus.code}/${plan.service_date}`}
            className="glass-tile flex flex-col gap-4 transition hover:-translate-y-0.5 hover:bg-white/70 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h2 className="text-lg font-semibold">
                {formatServiceDate(plan.service_date)}
              </h2>
              <p className="muted mt-1 text-sm">
                {plan.title ?? plan.series_title ?? "Weekend service"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="pill">
                {plan.slotCount} slots
              </span>
              <span className="pill pill--review">
                {plan.openIncidentCount} review
              </span>
              <span className="pill pill--unmapped">
                {plan.unmappedCount} unmapped
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

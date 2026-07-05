import Link from "next/link";
import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth/server";
import {
  displayPlanTitle,
  formatDelta,
  formatDuration,
  formatServiceDate,
} from "@/lib/variance/format";
import { listServiceDates } from "@/lib/variance/queries";

/** Date-level verdict chip: the day's most-over service, vs plan. */
function DateVerdict({ worstDeltaSeconds }: { worstDeltaSeconds: number | null }) {
  if (worstDeltaSeconds === null) {
    return <span className="pill pill--review">Needs review</span>;
  }
  if (worstDeltaSeconds > 60) {
    return (
      <span className="pill pill--over">
        {formatDelta(worstDeltaSeconds)} over plan
      </span>
    );
  }
  if (worstDeltaSeconds < -60) {
    return (
      <span className="pill pill--under">
        {formatDuration(-worstDeltaSeconds)} under plan
      </span>
    );
  }
  return <span className="pill pill--under">On plan</span>;
}

export default async function CampusVariancePage({
  params,
}: {
  params: Promise<{ campus: string }>;
}) {
  const { campus: code } = await params;
  const [result, session] = await Promise.all([
    listServiceDates(code),
    getSession(),
  ]);
  if (!result) notFound();
  const isOperator = session?.role === "operator";

  return (
    <main className="app-page app-page--narrow">
      <Link href="/variance" className="app-link text-sm">
        ← All Locations
      </Link>
      <p className="instrument-eyebrow mt-8">
        {result.campus.code}
      </p>
      <h1 className="instrument-title">{result.campus.name}</h1>

      <div className="mt-10 space-y-4">
        {result.dates.length === 0 && (
          <div className="glass-tile">
            <p className="font-semibold">No Sundays here yet.</p>
            <p className="muted mt-2 text-sm">
              {result.campus.name}&apos;s services will appear after the next
              Sunday-evening ingest. Check back Monday, or{" "}
              <Link href="/variance" className="app-link">
                pick another Location
              </Link>
              .
            </p>
          </div>
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
                {displayPlanTitle(plan.title, plan.series_title)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <DateVerdict worstDeltaSeconds={plan.worstDeltaSeconds} />
              <span className="pill">
                {plan.slotCount} service{plan.slotCount === 1 ? "" : "s"}
              </span>
              {isOperator && plan.openIncidentCount > 0 && (
                <span className="pill pill--review">
                  {plan.openIncidentCount} in Triage
                </span>
              )}
              {isOperator && plan.unmappedCount > 0 && (
                <span className="pill pill--unmapped">
                  {plan.unmappedCount} unmatched
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

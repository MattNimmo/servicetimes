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
    <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-10">
      <Link href="/variance" className="text-sm text-zinc-500 hover:text-cyan-300">
        ← All campuses
      </Link>
      <p className="mt-8 font-mono text-xs tracking-[0.2em] text-cyan-400 uppercase">
        {result.campus.code}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{result.campus.name}</h1>

      <div className="mt-10 space-y-4">
        {result.dates.length === 0 && (
          <p className="rounded-xl border border-zinc-800 p-6 text-zinc-400">
            No ingested service dates yet.
          </p>
        )}
        {result.dates.map((plan) => (
          <Link
            key={plan.id}
            href={`/variance/${result.campus.code}/${plan.service_date}`}
            className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 transition hover:border-cyan-500/60 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">
                {formatServiceDate(plan.service_date)}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {plan.title ?? plan.series_title ?? "Weekend service"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 font-mono text-xs uppercase">
              <span className="rounded-full bg-zinc-800 px-3 py-1.5 text-zinc-300">
                {plan.slotCount} slots
              </span>
              <span className="rounded-full bg-amber-950/60 px-3 py-1.5 text-amber-300">
                {plan.openIncidentCount} review
              </span>
              <span className="rounded-full bg-violet-950/60 px-3 py-1.5 text-violet-300">
                {plan.unmappedCount} unmapped
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

import Link from "next/link";

import { listCampuses } from "@/lib/variance/queries";

export default async function VarianceIndexPage() {
  const campuses = await listCampuses();

  return (
    <main className="app-page">
      <p className="instrument-eyebrow">
        Plan vs actual
      </p>
      <h1 className="instrument-title">Campus variance</h1>
      <p className="instrument-subtitle">
        Choose a campus to review completed service dates and timing quality.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {campuses.map((campus) => (
          <Link
            key={campus.id}
            href={`/variance/${campus.code}`}
            className="glass-tile group transition hover:-translate-y-0.5 hover:bg-white/70"
          >
            <span className="table-label">
              {campus.code}
            </span>
            <h2 className="mt-3 text-xl font-semibold group-hover:text-[var(--accent)]">
              {campus.name}
            </h2>
            <p className="muted mt-5 text-sm font-semibold">View service dates →</p>
          </Link>
        ))}
      </div>
    </main>
  );
}

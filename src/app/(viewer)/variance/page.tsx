import Link from "next/link";

import { listCampuses } from "@/lib/variance/queries";

// ECC's standard campus order: SLP (broadcast), ELK, LV, MG — matches the
// instrument views so campuses never shuffle between screens.
const CAMPUS_ORDER = ["SLP", "ELK", "LV", "MG"];

export default async function VarianceIndexPage() {
  const campuses = (await listCampuses()).sort(
    (a, b) => CAMPUS_ORDER.indexOf(a.code) - CAMPUS_ORDER.indexOf(b.code),
  );

  return (
    <main className="app-page">
      <p className="instrument-eyebrow">
        Plan vs actual
      </p>
      <h1 className="instrument-title">Service history</h1>
      <p className="instrument-subtitle">
        Pick a campus to see how each Sunday ran against plan.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {campuses.map((campus) => (
          <Link
            key={campus.id}
            href={`/variance/${campus.code}`}
            className="glass-tile group transition hover:-translate-y-0.5 hover:bg-white/70"
          >
            {/* Flex lives on a bare wrapper: .table-label is unlayered
                display:block and would override a layered flex utility,
                collapsing the gap and jamming the dot against the code. */}
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`campus-dot campus-dot--${campus.code.toLowerCase()}`}
              />
              <span className="table-label">{campus.code}</span>
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

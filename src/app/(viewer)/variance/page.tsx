import Link from "next/link";

import { listCampuses } from "@/lib/variance/queries";

export default async function VarianceIndexPage() {
  const campuses = await listCampuses();

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:px-10">
      <p className="font-mono text-xs tracking-[0.2em] text-cyan-400 uppercase">
        Plan vs actual
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Campus variance</h1>
      <p className="mt-4 max-w-2xl text-zinc-400">
        Choose a campus to review completed service dates and timing quality.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {campuses.map((campus) => (
          <Link
            key={campus.id}
            href={`/variance/${campus.code}`}
            className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 transition hover:border-cyan-500/60 hover:bg-zinc-900"
          >
            <span className="font-mono text-xs tracking-[0.18em] text-zinc-500 uppercase">
              {campus.code}
            </span>
            <h2 className="mt-3 text-xl font-semibold text-zinc-100 group-hover:text-cyan-300">
              {campus.name}
            </h2>
            <p className="mt-5 text-sm text-zinc-500">View service dates →</p>
          </Link>
        ))}
      </div>
    </main>
  );
}

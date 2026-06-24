import Link from "next/link";

import { requireRole } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireRole("viewer");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-10 px-6 py-20 sm:px-10">
      <div className="space-y-4">
        <p className="font-mono text-sm tracking-[0.24em] text-cyan-400 uppercase">
          ECC · Service Times
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          See where the service gained or lost time.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-400">
          Compare planned and actual timing by campus, service, and tracked
          element—without hiding questionable source data.
        </p>
      </div>

      <Link
        href="/variance"
        className="w-fit rounded-lg bg-cyan-400 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-cyan-300"
      >
        Open variance dashboard
      </Link>
    </main>
  );
}

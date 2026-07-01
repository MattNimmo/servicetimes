import Link from "next/link";

import { requireRole } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireRole("viewer");

  return (
    <main className="app-page app-page--narrow app-page--center gap-10">
      <div className="space-y-4">
        <p className="instrument-eyebrow">
          ECC · Service Times
        </p>
        <h1 className="instrument-title max-w-3xl">
          See where the service gained or lost time.
        </h1>
        <p className="instrument-subtitle max-w-2xl">
          Compare planned and actual timing by campus, service, and tracked
          element—without hiding questionable source data.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <Link
          href="/instrument/glance"
          className="btn btn--primary"
        >
          Open instrument
        </Link>
        <Link
          href="/variance"
          className="btn btn--ghost"
        >
          Open variance dashboard
        </Link>
      </div>
    </main>
  );
}

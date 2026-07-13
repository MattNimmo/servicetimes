import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { getTriageBadgeCount } from "@/lib/instrument/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requireRole("viewer");
  const isOperator = session.role === "operator";
  const triageCount = isOperator ? await getTriageBadgeCount() : 0;

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
          Planned vs actual timing for all four Locations — every service,
          every element, and the broadcast window.
        </p>
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap gap-4">
          <Link
            href="/variance"
            className="btn btn--primary"
          >
            This weekend at a glance
          </Link>
          <Link
            href="/instrument/glance"
            className="btn btn--ghost"
          >
            Dive deeper
          </Link>
          {isOperator && (
            <Link
              href="/instrument/triage"
              className="btn btn--ghost"
            >
              Verify
              {triageCount > 0 ? ` · ${triageCount} waiting` : ""}
            </Link>
          )}
        </div>
        <p className="muted text-sm">
          Fresh numbers land Sunday evening, after the weekly ingest.
        </p>
      </div>
    </main>
  );
}

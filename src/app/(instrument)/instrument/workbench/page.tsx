import Link from "next/link";

import { requireRole } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

type WorkbenchPageProps = {
  searchParams: Promise<{
    campus?: string;
    slot?: string;
  }>;
};

export default async function InstrumentWorkbenchPage({
  searchParams,
}: WorkbenchPageProps) {
  await requireRole("viewer");
  const params = await searchParams;
  const campus = params.campus?.toUpperCase() ?? "SLP";
  const slot = params.slot ?? "9am";

  return (
    <main className="instrument-page instrument-placeholder">
      <p className="instrument-eyebrow">Workbench</p>
      <h1 className="instrument-title">Service-flow workbench is next.</h1>
      <p className="instrument-subtitle">
        The instrument shell and Glance are now live. Workbench is the next build
        slice: slot-level flow, trend context, and element drill-in for{" "}
        <strong>{campus}</strong> · <strong>{slot}</strong>.
      </p>

      <section className="glass-card instrument-placeholder__card">
        <p className="instrument-eyebrow">Planned in this slice</p>
        <ul className="instrument-placeholder__list">
          <li>slot-level element stack in service order</li>
          <li>last / 6-week / 6-month / 12-month trend switching</li>
          <li>cross-campus comparison for the same tracked moment</li>
        </ul>

        <Link
          href={`/instrument/glance`}
          className="instrument-placeholder__link"
        >
          Back to Glance →
        </Link>
      </section>
    </main>
  );
}

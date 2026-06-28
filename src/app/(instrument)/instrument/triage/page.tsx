import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

type TriagePageProps = {
  searchParams: Promise<{
    campus?: string;
    date?: string;
  }>;
};

export default async function InstrumentTriagePage({
  searchParams,
}: TriagePageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "operator") notFound();

  const params = await searchParams;
  const campus = params.campus?.toUpperCase() ?? "SLP";
  const serviceDate = params.date ?? "latest";

  return (
    <main className="instrument-page instrument-placeholder">
      <p className="instrument-eyebrow">Triage</p>
      <h1 className="instrument-title">Service-context triage comes next.</h1>
      <p className="instrument-subtitle">
        We now have the protected instrument shell in place. The next slice is
        the in-flow triage experience for production-relevant plan times only,
        with rehearsal kept out of Sunday slot ties.
      </p>

      <section className="glass-card instrument-placeholder__card">
        <p className="instrument-eyebrow">Current focus</p>
        <ul className="instrument-placeholder__list">
          <li>
            selected campus: <strong>{campus}</strong>
          </li>
          <li>
            selected service date: <strong>{serviceDate}</strong>
          </li>
          <li>
            existing operator queue stays available while we move triage into the
            service-flow layout
          </li>
        </ul>

        <Link
          href={`/operator/review${params.campus || params.date ? `?${new URLSearchParams(
            Object.entries({
              ...(params.campus ? { campus: params.campus } : {}),
              ...(params.date ? { date: params.date } : {}),
            }),
          ).toString()}` : ""}`}
          className="instrument-placeholder__link"
        >
          Open current operator review →
        </Link>
      </section>
    </main>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-page app-page--center">
      <section className="glass-card p-8">
        <p className="instrument-eyebrow">ECC Service Times</p>
        <h1 className="instrument-title">We couldn&apos;t find that page.</h1>
        <p className="instrument-subtitle">
          The view may have moved, or the link may be out of date.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className="btn btn--primary">
            This weekend at a glance
          </Link>
          <Link href="/variance" className="btn btn--ghost">
            Service history
          </Link>
        </div>
      </section>
    </main>
  );
}

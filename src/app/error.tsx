"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="app-page app-page--center">
      <section className="glass-card p-8">
        <p className="instrument-eyebrow">ECC Service Times</p>
        <h1 className="instrument-title">Something went wrong loading this view.</h1>
        <p className="instrument-subtitle">
          The Tech Team can look into it if it keeps happening.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn btn--primary">
            Try again
          </button>
          <Link href="/" className="btn btn--ghost">
            This weekend at a glance
          </Link>
        </div>
      </section>
    </main>
  );
}

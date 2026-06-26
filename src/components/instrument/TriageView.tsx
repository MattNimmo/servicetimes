"use client";

export default function TriageView({
  campus,
  serviceDate,
  attentionCount,
}: {
  campus: string;
  serviceDate: string;
  attentionCount: number;
}) {
  return (
    <main style={{ maxWidth: 1360, margin: "0 auto", padding: "32px 24px 64px" }}>
      <div className="instrument-glass" style={{ borderRadius: 20, padding: 24, color: "var(--ink)" }}>
        <p style={{ fontSize: 11, letterSpacing: "0.18em", color: "var(--ink-55)", fontWeight: 600 }}>
          TRIAGE · FOUNDATION SLICE
        </p>
        <h1 style={{ marginTop: 12, fontSize: 40, lineHeight: 1.05, fontWeight: 700 }}>
          Resolve in the flow of the service.
        </h1>
        <p style={{ marginTop: 12, maxWidth: 760, color: "var(--ink-55)", lineHeight: 1.6 }}>
          The full Triage workbench is the next slice. For now, the route, auth
          gate, and nav badge are in place so the production-facing instrument
          shell is ready for the service-flow UI.
        </p>

        <dl style={{ marginTop: 24, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div>
            <dt style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-55)", fontWeight: 700 }}>
              CAMPUS
            </dt>
            <dd style={{ marginTop: 8, fontSize: 18, fontWeight: 600 }}>{campus}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-55)", fontWeight: 700 }}>
              SERVICE DATE
            </dt>
            <dd style={{ marginTop: 8, fontSize: 18, fontWeight: 600 }}>{serviceDate}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-55)", fontWeight: 700 }}>
              ATTENTION COUNT
            </dt>
            <dd style={{ marginTop: 8, fontSize: 18, fontWeight: 600 }}>{attentionCount}</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}

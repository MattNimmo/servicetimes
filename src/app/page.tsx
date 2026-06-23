const checks = [
  "Next.js + TypeScript scaffold",
  "Server-only, GET-only Planning Center client",
  "Services API pinned to 2018-11-01",
  "Production-safe credential boundary",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-10 px-6 py-20 sm:px-10">
      <div className="space-y-4">
        <p className="font-mono text-sm tracking-[0.24em] text-cyan-400 uppercase">
          Signal · Service Times v2
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          The pipe comes before the dashboard.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-400">
          This first slice verifies that the dedicated Planning Center Viewer
          account can read every required service type without exposing its
          credentials to the browser.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="font-mono text-xs tracking-[0.2em] text-zinc-500 uppercase">
          Scaffold status
        </h2>
        <ul className="mt-5 grid gap-3 text-zinc-200 sm:grid-cols-2">
          {checks.map((check) => (
            <li key={check} className="flex items-center gap-3">
              <span className="size-2 rounded-full bg-cyan-400" />
              {check}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

import { redirect } from "next/navigation";

import { getSession, loginAction } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-20">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 shadow-2xl shadow-black/30">
        <p className="font-mono text-xs tracking-[0.24em] text-cyan-400 uppercase">
          ECC Service Times
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-50">
          Sign in
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Use the shared viewer or operator password provided by Communications.
        </p>

        {error && (
          <div className="mt-6 rounded-lg border border-amber-800/70 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            {error === "config"
              ? "Authentication is not configured."
              : "That password was not recognized."}
          </div>
        )}

        <form action={loginAction} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-zinc-200" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-50 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}

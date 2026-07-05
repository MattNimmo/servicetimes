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
    <main className="app-page app-page--login app-page--center w-full">
      <div className="glass-tile p-8">
        <p className="instrument-eyebrow">
          ECC Service Times
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="muted mt-3 text-sm leading-6">
          Use the shared password from the Comms team. Operators use the
          operator password.
        </p>

        {error && (
          <div className="pill pill--review mt-6 justify-start rounded-lg px-4 py-3 text-left normal-case tracking-normal">
            {error === "config"
              ? "Authentication is not configured."
              : "That password was not recognized."}
          </div>
        )}

        <form action={loginAction} className="mt-6 space-y-4">
          <label className="table-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="glass-input"
          />
          <button
            type="submit"
            className="btn btn--primary btn--full"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}

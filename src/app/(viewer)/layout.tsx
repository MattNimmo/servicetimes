import Link from "next/link";

import { logoutAction, requireRole } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function ViewerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("viewer");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/95">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 sm:px-10">
          <Link href="/" className="font-mono text-sm tracking-[0.18em] text-cyan-400 uppercase">
            Service Times
          </Link>
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs tracking-wider text-zinc-500 uppercase">
              {session.role}
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

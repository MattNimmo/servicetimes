import Link from "next/link";

import { logoutAction, requireRole } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function ViewerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("viewer");

  return (
    <div className="instrument-root">
      <div className="instrument-backdrop" aria-hidden>
        <div className="instrument-backdrop__glow instrument-backdrop__glow--mg" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--elk" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--slp" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--lv" />
      </div>
      <header className="instrument-nav">
        <div className="instrument-nav__inner">
          <Link href="/" className="instrument-brand">
            <span className="instrument-brand__mark">ST</span>
            <span className="instrument-brand__wordmark">Service Times</span>
          </Link>
          <div className="instrument-nav__spacer" />
          <div className="flex items-center gap-4">
            <span className="pill">
              {session.role === "operator" ? "Operator" : "Viewer"}
            </span>
            <form action={logoutAction}>
              <button type="submit" className="instrument-signout">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="instrument-content">{children}</div>
    </div>
  );
}

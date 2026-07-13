import Link from "next/link";

import { logoutAction } from "@/lib/auth/server";

import InstrumentTabs from "./InstrumentTabs";

export default function InstrumentNav({
  isOperator,
  triageBadge,
  showRole = false,
}: {
  isOperator: boolean;
  triageBadge: number;
  showRole?: boolean;
}) {
  return (
    <header className="instrument-nav">
      <div className="instrument-nav__inner">
        <Link href="/" className="instrument-brand">
          <span className="instrument-brand__mark">ST</span>
          <span className="instrument-brand__wordmark">Service Times</span>
        </Link>

        <InstrumentTabs isOperator={isOperator} triageBadge={triageBadge} />

        <div className="instrument-nav__spacer" />

        <div className="instrument-nav__account">
          {showRole && (
            <span className="pill">{isOperator ? "Operator" : "Viewer"}</span>
          )}
          <form action={logoutAction}>
            <button type="submit" className="instrument-signout">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

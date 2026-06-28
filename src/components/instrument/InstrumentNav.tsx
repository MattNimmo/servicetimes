import Link from "next/link";

import { logoutAction } from "@/lib/auth/server";

import InstrumentTabs from "./InstrumentTabs";

export default function InstrumentNav({
  isOperator,
  triageBadge,
}: {
  isOperator: boolean;
  triageBadge: number;
}) {
  return (
    <header className="instrument-nav">
      <div className="instrument-nav__inner">
        <Link href="/" className="instrument-brand">
          <span className="instrument-brand__mark">E</span>
          <span className="instrument-brand__wordmark">Service Times</span>
        </Link>

        <InstrumentTabs isOperator={isOperator} triageBadge={triageBadge} />

        <div className="instrument-nav__spacer" />

        <form action={logoutAction}>
          <button type="submit" className="instrument-signout">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

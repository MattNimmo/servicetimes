"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{
  label: "At a glance" | "Review" | "Workbench" | "Verify";
  href:
    | "/variance"
    | "/instrument/glance"
    | "/instrument/workbench"
    | "/instrument/triage";
  operatorOnly?: boolean;
}> = [
  { label: "At a glance", href: "/variance" },
  { label: "Review", href: "/instrument/glance" },
  { label: "Workbench", href: "/instrument/workbench" },
  { label: "Verify", href: "/instrument/triage", operatorOnly: true },
];

export default function InstrumentTabs({
  isOperator,
  triageBadge,
}: {
  isOperator: boolean;
  triageBadge: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="instrument-tabs" aria-label="Service time views">
      {TABS.filter((tab) => !tab.operatorOnly || isOperator).map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`instrument-tab${active ? " instrument-tab--active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
            {tab.label === "Verify" && triageBadge > 0 ? (
              <span className="instrument-tab__badge">{triageBadge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

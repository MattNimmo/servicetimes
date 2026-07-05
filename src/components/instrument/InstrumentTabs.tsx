"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{
  label: "Glance" | "Workbench" | "Triage";
  href: "/instrument/glance" | "/instrument/workbench" | "/instrument/triage";
  operatorOnly?: boolean;
}> = [
  { label: "Glance", href: "/instrument/glance" },
  { label: "Workbench", href: "/instrument/workbench" },
  { label: "Triage", href: "/instrument/triage", operatorOnly: true },
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
    <nav className="instrument-tabs" aria-label="Instrument views">
      {TABS.filter((tab) => !tab.operatorOnly || isOperator).map((tab) => {
        const active = pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`instrument-tab${active ? " instrument-tab--active" : ""}`}
          >
            {tab.label}
            {tab.label === "Triage" && triageBadge > 0 ? (
              <span className="instrument-tab__badge">{triageBadge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

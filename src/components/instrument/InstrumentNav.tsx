"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type InstrumentTab = {
  label: "GLANCE" | "WORKBENCH" | "TRIAGE";
  href: "/instrument/glance" | "/instrument/workbench" | "/instrument/triage";
  operatorOnly?: boolean;
};

const TABS: InstrumentTab[] = [
  { label: "GLANCE", href: "/instrument/glance" },
  { label: "WORKBENCH", href: "/instrument/workbench" },
  { label: "TRIAGE", href: "/instrument/triage", operatorOnly: true },
];

export default function InstrumentNav({
  isOperator,
  triageBadge,
  logoutForm,
}: {
  isOperator: boolean;
  triageBadge: number;
  logoutForm: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 64,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        background: "rgba(255,255,255,0.45)",
        borderBottom: "1px solid rgba(255,255,255,0.7)",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 4,
      }}
    >
      <span
        style={{
          marginRight: 20,
          width: 28,
          height: 28,
          borderRadius: 7,
          background: "linear-gradient(135deg, #2C7E8C, #4F86C6)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        E
      </span>

      {TABS.filter((tab) => !tab.operatorOnly || isOperator).map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              position: "relative",
              padding: "6px 14px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              color: active ? "var(--ink)" : "var(--ink-55)",
              background: active ? "#fff" : "transparent",
              boxShadow: active
                ? "0 1px 4px rgba(50,52,90,0.10), 0 0 0 1px rgba(255,255,255,0.8)"
                : "none",
              transition: "all 0.14s ease",
              textDecoration: "none",
            }}
          >
            {tab.label}
            {tab.label === "TRIAGE" && triageBadge > 0 ? (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 999,
                  background: "var(--over)",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 3px",
                }}
              >
                {triageBadge}
              </span>
            ) : null}
          </Link>
        );
      })}

      <div style={{ flex: 1 }} />
      {logoutForm}
    </nav>
  );
}

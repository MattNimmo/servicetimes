import { Sora } from "next/font/google";

import InstrumentNav from "@/components/instrument/InstrumentNav";
import { getSession, logoutAction } from "@/lib/auth/server";
import { getTriageBadgeCount } from "@/lib/instrument/queries";

import "./instrument.css";

const sora = Sora({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export default async function InstrumentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const triageBadge = session ? await getTriageBadgeCount() : 0;

  return (
    <div
      className={sora.className}
      style={{
        minHeight: "100vh",
        background: "var(--glass-bg)",
        color: "var(--ink)",
        position: "relative",
      }}
    >
      <div
        aria-hidden
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}
      >
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "8%",
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: "radial-gradient(circle, #2EC4B6 0%, transparent 70%)",
            opacity: 0.28,
            filter: "blur(85px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "15%",
            right: "12%",
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: "radial-gradient(circle, #4F86C6 0%, transparent 70%)",
            opacity: 0.26,
            filter: "blur(80px)",
          }}
        />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        <InstrumentNav
          isOperator={session?.role === "operator"}
          triageBadge={triageBadge}
          logoutForm={
            <form action={logoutAction}>
              <button
                type="submit"
                style={{
                  fontSize: 11,
                  color: "var(--ink-55)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Sign out
              </button>
            </form>
          }
        />
        {children}
      </div>
    </div>
  );
}

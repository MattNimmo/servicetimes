import { Sora } from "next/font/google";

import InstrumentNav from "@/components/instrument/InstrumentNav";
import { getSession } from "@/lib/auth/server";
import { getTriageBadgeCount } from "@/lib/instrument/queries";

import "./instrument.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const dynamic = "force-dynamic";

export default async function InstrumentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, triageBadge] = await Promise.all([
    getSession(),
    getTriageBadgeCount(),
  ]);

  return (
    <div className={`${sora.className} instrument-root`}>
      <div className="instrument-backdrop" aria-hidden>
        <div className="instrument-backdrop__glow instrument-backdrop__glow--mg" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--elk" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--slp" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--lv" />
      </div>

      <div className="instrument-content">
        <InstrumentNav
          isOperator={session?.role === "operator"}
          triageBadge={triageBadge}
        />
        {children}
      </div>
    </div>
  );
}

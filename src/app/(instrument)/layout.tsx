import DashboardGuide from "@/components/instrument/DashboardGuide";
import InstrumentNav from "@/components/instrument/InstrumentNav";
import { getSession } from "@/lib/auth/server";
import { getTriageBadgeCount } from "@/lib/instrument/queries";

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
    <div className="instrument-root">
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
        <DashboardGuide />
        {children}
      </div>
    </div>
  );
}

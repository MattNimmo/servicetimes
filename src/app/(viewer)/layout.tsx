import InstrumentNav from "@/components/instrument/InstrumentNav";
import { requireRole } from "@/lib/auth/server";
import { getTriageBadgeCount } from "@/lib/instrument/queries";

export const dynamic = "force-dynamic";

export default async function ViewerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("viewer");
  const isOperator = session.role === "operator";
  const triageBadge = isOperator ? await getTriageBadgeCount() : 0;

  return (
    <div className="instrument-root">
      <div className="instrument-backdrop" aria-hidden>
        <div className="instrument-backdrop__glow instrument-backdrop__glow--mg" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--elk" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--slp" />
        <div className="instrument-backdrop__glow instrument-backdrop__glow--lv" />
      </div>
      <InstrumentNav
        isOperator={isOperator}
        triageBadge={triageBadge}
        showRole
      />
      <div className="instrument-content">{children}</div>
    </div>
  );
}

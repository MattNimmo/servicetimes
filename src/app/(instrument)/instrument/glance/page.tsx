import GlanceView from "@/components/instrument/GlanceView";
import { requireRole } from "@/lib/auth/server";
import { getBroadcastWindowTrend, getGlanceData } from "@/lib/instrument/queries";
import { getIngestionHealth } from "@/lib/pco/ingest-health";

export const dynamic = "force-dynamic";

export default async function InstrumentGlancePage() {
  const session = await requireRole("viewer");
  const isOperator = session.role === "operator";
  const [campuses, broadcastTrend, ingestionHealth] = await Promise.all([
    getGlanceData(),
    getBroadcastWindowTrend(),
    isOperator ? getIngestionHealth() : Promise.resolve(null),
  ]);

  return (
    <GlanceView
      campuses={campuses}
      broadcastTrend={broadcastTrend}
      ingestionHealth={ingestionHealth}
      isOperator={isOperator}
    />
  );
}

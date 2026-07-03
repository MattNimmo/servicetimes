import GlanceView from "@/components/instrument/GlanceView";
import { requireRole } from "@/lib/auth/server";
import { getBroadcastWindowTrend, getGlanceData } from "@/lib/instrument/queries";

export const dynamic = "force-dynamic";

export default async function InstrumentGlancePage() {
  await requireRole("viewer");
  const [campuses, broadcastTrend] = await Promise.all([
    getGlanceData(),
    getBroadcastWindowTrend(),
  ]);

  return <GlanceView campuses={campuses} broadcastTrend={broadcastTrend} />;
}

import GlanceView from "@/components/instrument/GlanceView";
import { requireRole } from "@/lib/auth/server";
import { getGlanceData } from "@/lib/instrument/queries";

export const dynamic = "force-dynamic";

export default async function GlancePage() {
  await requireRole("viewer");
  const campuses = await getGlanceData();
  return <GlanceView campuses={campuses} />;
}

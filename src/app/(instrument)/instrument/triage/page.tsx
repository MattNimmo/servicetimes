import { notFound, redirect } from "next/navigation";

import TriageView from "@/components/instrument/TriageView";
import { getSession } from "@/lib/auth/server";
import { getGlanceData, getTriageBadgeCount } from "@/lib/instrument/queries";

export const dynamic = "force-dynamic";

export default async function TriagePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "operator") notFound();

  const [campuses, attentionCount] = await Promise.all([
    getGlanceData(),
    getTriageBadgeCount(),
  ]);
  const fallback = campuses[0];
  if (!fallback) notFound();

  return (
    <TriageView
      campus={fallback.name}
      serviceDate={fallback.serviceDate}
      attentionCount={attentionCount}
    />
  );
}

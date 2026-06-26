import { notFound } from "next/navigation";

import WorkbenchView from "@/components/instrument/WorkbenchView";
import { requireRole } from "@/lib/auth/server";
import { getWorkbenchData, type WorkbenchHorizon } from "@/lib/instrument/queries";

export const dynamic = "force-dynamic";

const ALLOWED_HORIZONS = new Set<WorkbenchHorizon>(["last", "6wk", "6mo", "12mo"]);

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<{ campus?: string; slot?: string; horizon?: string }>;
}) {
  await requireRole("viewer");
  const { campus = "SLP", slot = "9am", horizon = "last" } = await searchParams;
  const safeHorizon = ALLOWED_HORIZONS.has(horizon as WorkbenchHorizon)
    ? (horizon as WorkbenchHorizon)
    : "last";
  const data = await getWorkbenchData(campus, slot, safeHorizon);
  if (!data) notFound();

  return (
    <WorkbenchView
      data={data}
      availableSlots={data.availableSlotLabels}
      horizon={safeHorizon}
    />
  );
}

import { notFound, redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { getWorkbenchData, type WorkbenchHorizon } from "@/lib/instrument/queries";
import { normalizeServiceSlotKey } from "@/lib/service-slot-identity";
import WorkbenchView from "@/components/instrument/WorkbenchView";

export const dynamic = "force-dynamic";

type WorkbenchPageProps = {
  searchParams: Promise<{
    campus?: string;
    slot?: string;
    horizon?: string;
  }>;
};

export default async function InstrumentWorkbenchPage({
  searchParams,
}: WorkbenchPageProps) {
  const session = await requireRole("viewer");
  const params = await searchParams;
  const campus = (params.campus?.toUpperCase() ?? "SLP") as string;
  const requestedSlot = params.slot;
  const slot = normalizeServiceSlotKey(requestedSlot);
  if (!slot) notFound();
  // Default to 6 weeks so the workbench opens with trend context, not a
  // single Sunday.
  const horizon = (params.horizon ?? "6wk") as WorkbenchHorizon;

  const data = await getWorkbenchData(campus, slot, horizon);
  if (!data) notFound();

  if ((requestedSlot ?? "first") !== data.slot.slotKey || slot !== data.slot.slotKey) {
    redirect(
      `/instrument/workbench?campus=${encodeURIComponent(campus)}&slot=${data.slot.slotKey}&horizon=${horizon}`,
    );
  }

  return (
    <WorkbenchView
      data={data}
      campus={campus}
      slot={data.slot.slotKey}
      horizon={horizon}
      isOperator={session.role === "operator"}
    />
  );
}

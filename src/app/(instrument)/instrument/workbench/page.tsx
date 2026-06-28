import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { getWorkbenchData, type WorkbenchHorizon } from "@/lib/instrument/queries";
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
  await requireRole("viewer");
  const params = await searchParams;
  const campus = (params.campus?.toUpperCase() ?? "SLP") as string;
  const slot = params.slot ?? "9am";
  const horizon = (params.horizon ?? "last") as WorkbenchHorizon;

  const data = await getWorkbenchData(campus, slot, horizon);
  if (!data) notFound();

  return <WorkbenchView data={data} campus={campus} slot={slot} horizon={horizon} />;
}

import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/auth/server";
import { getTriageData, listInstrumentServiceDates } from "@/lib/instrument/queries";
import TriageView from "@/components/instrument/TriageView";

export const dynamic = "force-dynamic";

type TriagePageProps = {
  searchParams: Promise<{
    campus?: string;
    date?: string;
  }>;
};

export default async function InstrumentTriagePage({
  searchParams,
}: TriagePageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "operator") notFound();

  const params = await searchParams;
  const campus = params.campus?.toUpperCase() ?? "SLP";
  const serviceDate = params.date ?? "latest";

  let data = await getTriageData(campus, serviceDate);
  if (!data && serviceDate !== "latest") {
    data = await getTriageData(campus, "latest");
  }
  if (!data) notFound();

  const availableDates = await listInstrumentServiceDates(campus);

  return <TriageView data={data} campus={campus} availableDates={availableDates} />;
}

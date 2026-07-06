import { runRecurringPcoIngestion } from "@/lib/pco/recurring-ingestion";
import { runSecuredPcoIngest } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ingest = (request: Request) =>
  runSecuredPcoIngest(request, "pco-ingest", runRecurringPcoIngestion);

export const GET = ingest;
export const POST = ingest;

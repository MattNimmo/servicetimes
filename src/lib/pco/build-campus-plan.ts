import "server-only";

import { fetchLatestCompletedPlan } from "@/lib/pco/fetch-plan";
import { mostRecentChicagoSunday } from "@/lib/pco/ingest-health";
import { buildIngestionPlan, type PcoCampus } from "@/lib/pco/ingestion-plan";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";

export async function buildCampusPlan(
  campus: PcoCampus,
  expectedServiceDate = mostRecentChicagoSunday(new Date()),
) {
  const bundle = await fetchLatestCompletedPlan(
    campus.serviceTypeId,
    expectedServiceDate,
  );
  return buildIngestionPlan(campus, bundle, PCO_TAXONOMY);
}

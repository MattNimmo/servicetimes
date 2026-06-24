import "server-only";

import { fetchLatestCompletedPlan } from "@/lib/pco/fetch-plan";
import { buildIngestionPlan, type PcoCampus } from "@/lib/pco/ingestion-plan";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";

export async function buildCampusPlan(campus: PcoCampus) {
  const bundle = await fetchLatestCompletedPlan(campus.serviceTypeId);
  return buildIngestionPlan(campus, bundle, PCO_TAXONOMY);
}

import "server-only";

import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import { fetchLatestCompletedPlan } from "@/lib/pco/fetch-plan";
import { buildIngestionPlan } from "@/lib/pco/ingestion-plan";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";

async function previewCampus(campus: (typeof PCO_CAMPUSES)[number]) {
  const bundle = await fetchLatestCompletedPlan(campus.serviceTypeId);
  return buildIngestionPlan(campus, bundle, PCO_TAXONOMY);
}

export async function previewLatestPcoIngestion() {
  const results = await Promise.allSettled(PCO_CAMPUSES.map(previewCampus));

  return {
    ok: results.every(({ status }) => status === "fulfilled"),
    generatedAt: new Date().toISOString(),
    dryRun: true,
    writesPerformed: 0,
    campuses: results.map((result, index) => {
      if (result.status === "fulfilled") return result.value;

      return {
        campus: PCO_CAMPUSES[index].code,
        dryRun: true,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown Planning Center error",
      };
    }),
  };
}

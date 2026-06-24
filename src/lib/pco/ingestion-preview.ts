import "server-only";

import { buildCampusPlan } from "@/lib/pco/build-campus-plan";
import { PCO_CAMPUSES } from "@/lib/pco/campuses";

export async function previewLatestPcoIngestion() {
  const results = await Promise.allSettled(PCO_CAMPUSES.map(buildCampusPlan));

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

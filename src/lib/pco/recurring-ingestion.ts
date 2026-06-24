import "server-only";

import { buildCampusPlan } from "@/lib/pco/build-campus-plan";
import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import { persistIngestionPlan } from "@/lib/pco/ingestion-writer";

type Dependencies = {
  buildCampusPlan: typeof buildCampusPlan;
  persistPlan: typeof persistIngestionPlan;
};

const defaultDependencies: Dependencies = {
  buildCampusPlan,
  persistPlan: persistIngestionPlan,
};

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "Unknown ingestion error";
}

export async function runRecurringPcoIngestion(
  dependencies: Dependencies = defaultDependencies,
) {
  const previews = await Promise.allSettled(
    PCO_CAMPUSES.map(dependencies.buildCampusPlan),
  );

  if (previews.some(({ status }) => status === "rejected")) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      writesPerformed: 0,
      campuses: previews.map((result, index) =>
        result.status === "fulfilled"
          ? {
              campus: PCO_CAMPUSES[index].code,
              pcoPlanId: result.value.plan.pcoPlanId,
              status: "previewed" as const,
            }
          : {
              campus: PCO_CAMPUSES[index].code,
              status: "preview_failed" as const,
              error: errorMessage(result.reason),
            },
      ),
    };
  }

  const plans = previews.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const writes = await Promise.allSettled(plans.map(dependencies.persistPlan));

  return {
    ok: writes.every(({ status }) => status === "fulfilled"),
    generatedAt: new Date().toISOString(),
    writesPerformed: writes.filter(({ status }) => status === "fulfilled").length,
    campuses: writes.map((result, index) =>
      result.status === "fulfilled"
        ? {
            campus: PCO_CAMPUSES[index].code,
            pcoPlanId: plans[index].plan.pcoPlanId,
            status: "committed" as const,
            result: result.value,
          }
        : {
            campus: PCO_CAMPUSES[index].code,
            pcoPlanId: plans[index].plan.pcoPlanId,
            status: "write_failed" as const,
            error: errorMessage(result.reason),
          },
    ),
  };
}

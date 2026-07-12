import { authorizeGitHubIngestWatchdog } from "@/lib/auth/github-actions-oidc";
import { getIngestionHealth } from "@/lib/pco/ingest-health";
import { runRecurringPcoIngestion } from "@/lib/pco/recurring-ingestion";
import { runSecuredPcoIngest } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const watchdog = (request: Request) =>
  runSecuredPcoIngest(
    request,
    "pco-ingest-watchdog",
    async () => {
      const health = await getIngestionHealth();
      if (health.status === "current") {
        return {
          ok: true,
          generatedAt: new Date().toISOString(),
          expectedServiceDate: health.expectedServiceDate,
          writesPerformed: 0,
          skipped: "already_current",
          verification: {
            successfulLocations: health.successfulLocations,
            expectedLocations: health.expectedLocations,
          },
        };
      }

      return runRecurringPcoIngestion();
    },
    { additionalAuthorization: authorizeGitHubIngestWatchdog },
  );

export const GET = watchdog;
export const POST = watchdog;

import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import { fetchLatestCompletedPlan } from "@/lib/pco/fetch-plan";
import { buildIngestionPlan, type IngestionPlan } from "@/lib/pco/ingestion-plan";
import { verifyIngestionPlan } from "@/lib/pco/ingestion-verifier";
import { persistIngestionPlan } from "@/lib/pco/ingestion-writer";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";

type CliOptions = {
  campus: string;
  commit: boolean;
  verify: boolean;
  ingestRunId?: number;
};

type Dependencies = {
  fetchPlan: typeof fetchLatestCompletedPlan;
  buildPlan: typeof buildIngestionPlan;
  persistPlan: typeof persistIngestionPlan;
  verifyPlan: typeof verifyIngestionPlan;
  log: (message: string) => void;
};

const defaultDependencies: Dependencies = {
  fetchPlan: fetchLatestCompletedPlan,
  buildPlan: buildIngestionPlan,
  persistPlan: persistIngestionPlan,
  verifyPlan: verifyIngestionPlan,
  log: console.log,
};

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { campus: "SLP", commit: false, verify: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--commit") options.commit = true;
    else if (arg === "--verify") options.verify = true;
    else if (arg === "--campus") {
      const campus = args[index + 1];
      if (!campus || campus.startsWith("--")) throw new Error("--campus requires a code");
      options.campus = campus.toUpperCase();
      index += 1;
    } else if (arg === "--ingest-run-id") {
      const value = Number(args[index + 1]);
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("--ingest-run-id requires a positive integer");
      }
      options.ingestRunId = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.verify && !options.commit && options.ingestRunId === undefined) {
    throw new Error("Standalone --verify requires --ingest-run-id <ID>");
  }

  return options;
}

function printDryRun(plan: IngestionPlan, log: Dependencies["log"]) {
  log(`Dry-run: ${plan.campus} ${plan.plan.serviceDate} (PCO plan ${plan.plan.pcoPlanId})`);
  log(JSON.stringify(plan.summary, null, 2));
  for (const planTime of plan.planTimes) {
    log(
      `PlanTime ${planTime.pcoPlanTimeId}: slot=${planTime.detectedSlotLabel ?? "unresolved"} state=${planTime.slotResolutionState}`,
    );
  }
}

function printVerification(
  result: Awaited<ReturnType<typeof verifyIngestionPlan>>,
  log: Dependencies["log"],
) {
  log("Verification:");
  for (const row of result.checks) {
    log(
      `${row.pass ? "PASS" : "FAIL"} | ${row.check} | expected=${row.expected} | actual=${row.actual}`,
    );
  }
  log(result.ok ? "Verification PASSED" : "Verification FAILED");
}

export async function runIngestionCli(
  args: string[],
  dependencies: Dependencies = defaultDependencies,
) {
  const options = parseArgs(args);
  const campus = PCO_CAMPUSES.find(({ code }) => code === options.campus);
  if (!campus) throw new Error(`Unknown campus code: ${options.campus}`);

  const bundle = await dependencies.fetchPlan(campus.serviceTypeId);
  const plan = dependencies.buildPlan(campus, bundle, PCO_TAXONOMY);
  printDryRun(plan, dependencies.log);

  let ingestRunId = options.ingestRunId;
  if (options.commit) {
    if (process.env.ENABLE_PCO_INGESTION_WRITES !== "true") {
      throw new Error("ENABLE_PCO_INGESTION_WRITES=true is required for --commit");
    }
    const persisted = await dependencies.persistPlan(plan);
    ingestRunId = persisted.ingestRunId;
    dependencies.log(`Committed: ${JSON.stringify(persisted)}`);
  }

  if (options.verify) {
    if (ingestRunId === undefined) throw new Error("An ingest run ID is required to verify");
    const verification = await dependencies.verifyPlan(plan, ingestRunId);
    printVerification(verification, dependencies.log);
    if (!verification.ok) throw new Error("Ingestion verification failed");
  }

  return { plan, ingestRunId };
}

async function main() {
  loadEnvConfig(process.cwd());
  try {
    await runIngestionCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown ingestion error");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

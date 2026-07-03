// Sampling QA (backfill Phase 4): re-fetch N random journaled plans from PCO,
// rebuild the ingestion plan, and verify the DB matches.
import { readFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";

import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import { fetchPlanBundleIfCompleted } from "@/lib/pco/fetch-plan";
import { buildIngestionPlan } from "@/lib/pco/ingestion-plan";
import { verifyIngestionPlan } from "@/lib/pco/ingestion-verifier";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";
import { pcoGet } from "@/lib/pco/client";
import type { PcoPlan } from "@/lib/pco/types";

type JournalEntry = { campus: string; pcoPlanId: string; serviceDate: string; ingestRunId: number };

async function main() {
  loadEnvConfig(process.cwd());
  const journalPath = process.argv[2] ?? "backfill-journal.jsonl";
  const sampleSize = Number(process.argv[3] ?? 8);

  const entries: JournalEntry[] = readFileSync(journalPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  // Deterministic spread: sort by date and take evenly spaced entries across
  // the year and campuses.
  const sorted = [...entries].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  const step = Math.max(1, Math.floor(sorted.length / sampleSize));
  const sample = sorted.filter((_, index) => index % step === 0).slice(0, sampleSize);

  let failures = 0;
  for (const entry of sample) {
    const campus = PCO_CAMPUSES.find(({ code }) => code === entry.campus)!;
    const { data: pcoPlan } = await pcoGet<{ data: PcoPlan }>(
      `/services/v2/service_types/${campus.serviceTypeId}/plans/${entry.pcoPlanId}`,
    );
    const result = await fetchPlanBundleIfCompleted(campus.serviceTypeId, pcoPlan);
    if (result.status !== "ok") {
      console.log(`SKIP ${entry.campus} ${entry.serviceDate}: ${result.reason}`);
      continue;
    }
    const plan = buildIngestionPlan(campus, result.bundle, PCO_TAXONOMY);
    const verification = await verifyIngestionPlan(plan, entry.ingestRunId);
    const failed = verification.checks.filter((check) => !check.pass);
    console.log(
      `${verification.ok ? "PASS" : "FAIL"} ${entry.campus} ${entry.serviceDate} (run ${entry.ingestRunId})${
        failed.length > 0 ? ` — ${failed.map((c) => `${c.check}: expected=${c.expected} actual=${c.actual}`).join("; ")}` : ""
      }`,
    );
    if (!verification.ok) failures += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(failures === 0 ? "\nSampling QA PASSED" : `\nSampling QA: ${failures} failure(s)`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});

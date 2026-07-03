// Historical backfill runner — see docs/backfill-ingestion-build-plan.md.
//
//   npm run backfill -- --since 2025-07-01                       # dry-run census, all campuses
//   npm run backfill -- --since 2025-07-01 --campus SLP          # one campus
//   npm run backfill -- --since 2025-07-01 --commit              # committed backfill (journaled)
//
// Dry-run (default) writes an aggregate census markdown instead of ingesting.
// Commits are journaled (JSONL) so an interrupted run resumes where it left off.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { PcoRequestError } from "@/lib/pco/client";
import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import {
  fetchPlanBundleIfCompleted,
  listPastPlansSince,
} from "@/lib/pco/fetch-plan";
import {
  buildIngestionPlan,
  type IngestionPlan,
  type PcoCampus,
} from "@/lib/pco/ingestion-plan";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";
import { persistIngestionPlan } from "@/lib/pco/ingestion-writer";

type CliOptions = {
  campuses: PcoCampus[];
  since: string;
  commit: boolean;
  journalPath: string;
  censusPath: string;
  delayMs: number;
};

export function parseArgs(args: string[]): CliOptions {
  let since: string | null = null;
  let campusCodes: string[] = [];
  let commit = false;
  let journalPath = "backfill-journal.jsonl";
  let censusPath = "docs/backfill-census.md";
  let delayMs = 800;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--commit") commit = true;
    else if (arg === "--since") {
      since = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--weeks") {
      const weeks = Number(args[index + 1]);
      if (!Number.isSafeInteger(weeks) || weeks <= 0) {
        throw new Error("--weeks requires a positive integer");
      }
      const start = new Date(Date.now() - weeks * 7 * 24 * 3600 * 1000);
      since = start.toISOString().slice(0, 10);
      index += 1;
    } else if (arg === "--campus") {
      const code = args[index + 1];
      if (!code || code.startsWith("--")) throw new Error("--campus requires a code");
      campusCodes.push(code.toUpperCase());
      index += 1;
    } else if (arg === "--journal") {
      journalPath = args[index + 1] ?? journalPath;
      index += 1;
    } else if (arg === "--census") {
      censusPath = args[index + 1] ?? censusPath;
      index += 1;
    } else if (arg === "--delay-ms") {
      delayMs = Number(args[index + 1]);
      if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("--delay-ms requires a number");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error("--since YYYY-MM-DD (or --weeks N) is required");
  }

  if (campusCodes.length === 0) campusCodes = PCO_CAMPUSES.map(({ code }) => code);
  const campuses = campusCodes.map((code) => {
    const campus = PCO_CAMPUSES.find((c) => c.code === code);
    if (!campus) throw new Error(`Unknown campus code: ${code}`);
    return campus;
  });

  return { campuses, since, commit, journalPath, censusPath, delayMs };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry a PCO call on 429/5xx with a generous backoff. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const retryable =
        error instanceof PcoRequestError && (error.status === 429 || error.status >= 500);
      if (!retryable || attempt >= 4) throw error;
      const waitMs = attempt * 15_000;
      console.warn(`[backfill] ${label}: HTTP ${(error as PcoRequestError).status}, retry ${attempt}/3 in ${waitMs / 1000}s`);
      await sleep(waitMs);
    }
  }
}

// ── Journal (commit mode only) ───────────────────────────────────────────────

type JournalEntry = {
  campus: string;
  pcoPlanId: string;
  serviceDate: string;
  ingestRunId: number;
  ts: string;
};

function loadJournal(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const done = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as JournalEntry;
      done.add(entry.pcoPlanId);
    } catch {
      // Ignore malformed lines; worst case we redo an idempotent ingest.
    }
  }
  return done;
}

// ── Census aggregation ───────────────────────────────────────────────────────

type UnmappedAgg = {
  title: string;
  itemType: string;
  count: number;
  totalPlannedSeconds: number;
  sections: Set<string>;
  campuses: Set<string>;
};

type Census = {
  since: string;
  generatedFor: string[];
  plansSeen: number;
  plansIngestable: number;
  skipped: Array<{ campus: string; serviceDate: string; pcoPlanId: string; reason: string }>;
  unmapped: Map<string, UnmappedAgg>;
  incidents: Map<string, Map<string, number>>; // kind → campus → count
  slotFailures: Array<{ campus: string; serviceDate: string; pcoName: string | null; startsAt: string | null }>;
  weeksByCampus: Map<string, number>;
};

function recordPlanInCensus(census: Census, campus: PcoCampus, plan: IngestionPlan) {
  census.plansIngestable += 1;
  census.weeksByCampus.set(campus.code, (census.weeksByCampus.get(campus.code) ?? 0) + 1);

  for (const item of plan.items) {
    if (
      item.itemType === "header" ||
      item.isRollupChild ||
      item.elementKey !== null ||
      item.plannedSeconds <= 0 ||
      item.sectionKey === "pre_service" ||
      item.sectionKey === "post_service" ||
      item.servicePosition === "pre" ||
      item.servicePosition === "post"
    ) {
      continue;
    }
    const key = item.rawTitleNormalized;
    const agg = census.unmapped.get(key) ?? {
      title: item.rawTitle,
      itemType: item.itemType,
      count: 0,
      totalPlannedSeconds: 0,
      sections: new Set<string>(),
      campuses: new Set<string>(),
    };
    agg.count += 1;
    agg.totalPlannedSeconds += item.plannedSeconds;
    agg.sections.add(item.sectionKey ?? "(unsectioned)");
    agg.campuses.add(campus.code);
    census.unmapped.set(key, agg);
  }

  for (const incident of plan.incidents) {
    const byCampus = census.incidents.get(incident.kind) ?? new Map<string, number>();
    byCampus.set(campus.code, (byCampus.get(campus.code) ?? 0) + 1);
    census.incidents.set(incident.kind, byCampus);
  }

  for (const planTime of plan.planTimes) {
    if (planTime.timeType === "service" && planTime.detectedSlotLabel === null) {
      census.slotFailures.push({
        campus: campus.code,
        serviceDate: plan.plan.serviceDate,
        pcoName: planTime.pcoName,
        startsAt: planTime.startsAt,
      });
    }
  }
}

function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderCensus(census: Census): string {
  const lines: string[] = [];
  lines.push(`# Backfill census — since ${census.since}`);
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()} · campuses: ${census.generatedFor.join(", ")}`);
  lines.push("");
  lines.push(`- Plans seen: **${census.plansSeen}**`);
  lines.push(`- Ingestable (completed production service): **${census.plansIngestable}**`);
  lines.push(`- Skipped: **${census.skipped.length}**`);
  for (const [campus, weeks] of census.weeksByCampus) {
    lines.push(`  - ${campus}: ${weeks} ingestable weeks`);
  }
  lines.push("");

  lines.push("## Unmapped titles (ranked by total planned time)");
  lines.push("");
  lines.push("| Title | Type | Weeks | Total planned | Sections | Campuses |");
  lines.push("| --- | --- | ---: | ---: | --- | --- |");
  const rankedUnmapped = [...census.unmapped.values()].sort(
    (a, b) => b.totalPlannedSeconds - a.totalPlannedSeconds,
  );
  for (const agg of rankedUnmapped) {
    lines.push(
      `| ${agg.title} | ${agg.itemType} | ${agg.count} | ${formatMinutes(agg.totalPlannedSeconds)} | ${[...agg.sections].join(", ")} | ${[...agg.campuses].join(", ")} |`,
    );
  }
  if (rankedUnmapped.length === 0) lines.push("| _none_ | | | | | |");
  lines.push("");

  lines.push("## Incident histogram");
  lines.push("");
  lines.push("| Kind | " + census.generatedFor.join(" | ") + " | Total |");
  lines.push("| --- | " + census.generatedFor.map(() => "---:").join(" | ") + " | ---: |");
  for (const [kind, byCampus] of [...census.incidents.entries()].sort()) {
    const counts = census.generatedFor.map((code) => byCampus.get(code) ?? 0);
    lines.push(`| ${kind} | ${counts.join(" | ")} | ${counts.reduce((t, n) => t + n, 0)} |`);
  }
  lines.push("");

  lines.push("## Slot-resolution failures (production plan_times with no slot)");
  lines.push("");
  if (census.slotFailures.length === 0) {
    lines.push("_none_");
  } else {
    lines.push("| Campus | Service date | PCO name | Starts at |");
    lines.push("| --- | --- | --- | --- |");
    for (const failure of census.slotFailures) {
      lines.push(
        `| ${failure.campus} | ${failure.serviceDate} | ${failure.pcoName ?? "—"} | ${failure.startsAt ?? "—"} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Skipped plans");
  lines.push("");
  if (census.skipped.length === 0) {
    lines.push("_none_");
  } else {
    lines.push("| Campus | Service date | PCO plan | Reason |");
    lines.push("| --- | --- | --- | --- |");
    for (const skip of census.skipped) {
      lines.push(`| ${skip.campus} | ${skip.serviceDate} | ${skip.pcoPlanId} | ${skip.reason} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runBackfill(args: string[]) {
  const options = parseArgs(args);
  const log = console.log;

  if (options.commit && process.env.ENABLE_PCO_INGESTION_WRITES !== "true") {
    throw new Error("ENABLE_PCO_INGESTION_WRITES=true is required for --commit");
  }

  const journaled = options.commit ? loadJournal(options.journalPath) : new Set<string>();
  const census: Census = {
    since: options.since,
    generatedFor: options.campuses.map(({ code }) => code),
    plansSeen: 0,
    plansIngestable: 0,
    skipped: [],
    unmapped: new Map(),
    incidents: new Map(),
    slotFailures: [],
    weeksByCampus: new Map(),
  };

  for (const campus of options.campuses) {
    log(`[backfill] ${campus.code}: listing plans since ${options.since}…`);
    const plans = await withRetry(
      () => listPastPlansSince(campus.serviceTypeId, options.since),
      `${campus.code} plan listing`,
    );
    log(`[backfill] ${campus.code}: ${plans.length} past plans in window`);

    // Oldest-first so trends fill chronologically and a resume is intuitive.
    const ordered = [...plans].sort((a, b) =>
      a.attributes.sort_date.localeCompare(b.attributes.sort_date),
    );

    for (const [index, pcoPlan] of ordered.entries()) {
      census.plansSeen += 1;
      const label = `${campus.code} ${pcoPlan.attributes.sort_date.slice(0, 10)} (${index + 1}/${ordered.length})`;

      if (options.commit && journaled.has(pcoPlan.id)) {
        log(`[backfill] ${label}: already journaled — skip`);
        continue;
      }

      const result = await withRetry(
        () => fetchPlanBundleIfCompleted(campus.serviceTypeId, pcoPlan),
        `${label} bundle fetch`,
      );

      if (result.status === "skipped") {
        census.skipped.push({
          campus: campus.code,
          serviceDate: pcoPlan.attributes.sort_date.slice(0, 10),
          pcoPlanId: pcoPlan.id,
          reason: result.reason,
        });
        log(`[backfill] ${label}: skipped — ${result.reason}`);
        await sleep(options.delayMs);
        continue;
      }

      const plan = buildIngestionPlan(campus, result.bundle, PCO_TAXONOMY);
      recordPlanInCensus(census, campus, plan);

      if (options.commit) {
        const persisted = await persistIngestionPlan(plan);
        const entry: JournalEntry = {
          campus: campus.code,
          pcoPlanId: pcoPlan.id,
          serviceDate: plan.plan.serviceDate,
          ingestRunId: persisted.ingestRunId,
          ts: new Date().toISOString(),
        };
        appendFileSync(options.journalPath, `${JSON.stringify(entry)}\n`);
        log(
          `[backfill] ${label}: committed run=${persisted.ingestRunId} planTimes=${persisted.planTimesUpserted} items=${persisted.itemsUpserted} itemTimes=${persisted.itemTimesUpserted} incidents=${persisted.incidentsObserved}`,
        );
      } else {
        log(
          `[backfill] ${label}: dry-run ok — items=${plan.summary.itemCount} unmapped=${plan.summary.unmappedItemCount} incidents=${plan.summary.incidentCount}`,
        );
      }

      await sleep(options.delayMs);
    }
  }

  const markdown = renderCensus(census);
  mkdirSync(dirname(options.censusPath), { recursive: true });
  writeFileSync(options.censusPath, markdown);
  log(`[backfill] census written to ${options.censusPath}`);
  log(
    `[backfill] done: ${census.plansIngestable}/${census.plansSeen} ingestable, ${census.skipped.length} skipped, ${census.unmapped.size} distinct unmapped titles`,
  );

  return census;
}

async function main() {
  loadEnvConfig(process.cwd());
  try {
    await runBackfill(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown backfill error");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

// Backfill quality report (docs/backfill-ingestion-build-plan.md Phase 3).
// Reads the backfill_quality view and prints the grade distribution plus
// every non-green service, worst-first — the exception queue.
//
//   npm run backfill:report

import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { readRows } from "@/lib/supabase/rest";

type QualityRow = {
  campus: string;
  service_date: string;
  plan_time_id: number;
  slot_label: string;
  has_live_bounds: boolean;
  reconciliation_gap_seconds: number;
  mapped_planned_pct: number | null;
  actuals_complete: boolean;
  grade: "green" | "yellow" | "red";
};

async function main() {
  loadEnvConfig(process.cwd());

  const rows = await readRows<QualityRow>("backfill_quality", {
    select:
      "campus,service_date,plan_time_id,slot_label,has_live_bounds,reconciliation_gap_seconds,mapped_planned_pct,actuals_complete,grade",
    order: "service_date.asc",
    limit: "2000",
  });

  const byGrade = { green: 0, yellow: 0, red: 0 };
  const byCampus = new Map<string, { green: number; yellow: number; red: number }>();
  for (const row of rows) {
    byGrade[row.grade] += 1;
    const campus = byCampus.get(row.campus) ?? { green: 0, yellow: 0, red: 0 };
    campus[row.grade] += 1;
    byCampus.set(row.campus, campus);
  }

  console.log(`backfill_quality: ${rows.length} production plan_times`);
  console.log(
    `  green ${byGrade.green} (${Math.round((100 * byGrade.green) / Math.max(1, rows.length))}%) · yellow ${byGrade.yellow} · red ${byGrade.red}`,
  );
  for (const [campus, counts] of [...byCampus.entries()].sort()) {
    console.log(`  ${campus}: green ${counts.green} · yellow ${counts.yellow} · red ${counts.red}`);
  }

  const exceptions = rows
    .filter((row) => row.grade !== "green")
    .sort((a, b) => (a.grade === "red" ? 0 : 1) - (b.grade === "red" ? 0 : 1));

  if (exceptions.length > 0) {
    console.log("\nExceptions (review in Triage, worst-first):");
    console.log("grade  | campus | date       | slot | bounds | gap    | mapped% | complete");
    for (const row of exceptions) {
      console.log(
        `${row.grade.padEnd(6)} | ${row.campus.padEnd(6)} | ${row.service_date} | ${row.slot_label.padEnd(4)} | ${String(row.has_live_bounds).padEnd(6)} | ${String(row.reconciliation_gap_seconds).padStart(5)}s | ${String(row.mapped_planned_pct ?? "—").padStart(6)} | ${row.actuals_complete}`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown report error");
    process.exitCode = 1;
  });
}

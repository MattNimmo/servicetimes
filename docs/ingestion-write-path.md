# Ingestion write path — implementation spec

Status: **implemented** (2026-06-24).

## Why

`persistIngestionPlan` (`src/lib/pco/ingestion-writer.ts`) is the only code that
calls the atomic `ingest_pco_plan` RPC. Both the controlled script and recurring
route delegate to this boundary.

This slice adds the missing entry point so the first controlled production load
(roadmap step 4) can run, then reconciled (step 5).

## Decision: script first, then route + cron

Build a **server-side one-off script**, not a deployed route, for the first
load. Rationale: a write endpoint was premature surface area before a single
weekend had been validated by hand. The recurring route was added after the
controlled loads proved the write and reconciliation path.

## Existing building blocks (do not reimplement)

- `previewLatestPcoIngestion()` — fans out over all campuses, returns an array,
  `dryRun: true`. The new script reuses the per-campus pieces, not this aggregate.
- `fetchLatestCompletedPlan(serviceTypeId)` — returns one plan bundle.
- `buildIngestionPlan(campus, bundle, PCO_TAXONOMY)` — returns one **single-campus**
  `IngestionPlan` with `dryRun: true` and a `summary`.
- `persistIngestionPlan(plan)` — enforces `ENABLE_PCO_INGESTION_WRITES=true`,
  requires `plan.dryRun === true`, posts `{...plan, dryRun:false}` to the RPC,
  returns `{ ingestRunId, pcoPlanId, planTimesUpserted, itemsUpserted,
  itemTimesUpserted, incidentsObserved }`.
- The RPC is **atomic** (any error rolls back the whole call, including the
  `ingest_runs` row) and **idempotent** (upserts on PCO IDs). Re-running the
  same weekend is safe and produces no duplicates.

## Ingest granularity (important)

The unit of ingestion is a **whole PCO plan**, not a slot. SLP's latest completed
plan carries *both* the 9am and 11am `PlanTime`s; ingesting it writes both. You
cannot ingest "just 9am." Per the decision below we **start with SLP** and treat
the **9am slot as the first reconciliation focus**, but the 11am PlanTime will
also land in the same atomic call. Reconcile both; just verify 9am first.

## Script: `scripts/ingest-weekend.ts`

Run with `npm run ingest --` against production env vars. The command uses the
React server condition so the existing `server-only` protections remain intact
outside the Next.js runtime. It is single-campus per invocation (the RPC payload
is single-campus).

### Arguments

| Arg | Default | Meaning |
| --- | --- | --- |
| `--campus <CODE>` | `SLP` | Campus code to ingest (first run: `SLP`). |
| `--commit` | absent | Without it, **dry-run only**: print the plan summary and exit 0 without calling the writer. With it, call `persistIngestionPlan`. |
| `--verify` | absent | After a commit, run the reconciliation read (below) and print the comparison. Standalone use also requires `--ingest-run-id <ID>`. |
| `--ingest-run-id <ID>` | absent | Identifies the exact prior run for standalone verification; commit-and-verify uses the RPC's returned ID automatically. |

### Flow

1. Resolve the campus from `PCO_CAMPUSES` by `--campus`; hard error on unknown code.
2. `fetchLatestCompletedPlan(campus.serviceTypeId)` → bundle.
3. `buildIngestionPlan(campus, bundle, PCO_TAXONOMY)` → plan.
4. **Always print the dry-run summary first**: `plan.summary` (slot resolution
   counts, `unmappedItemCount`, `incidentCount`), the per-PlanTime
   `detectedSlotLabel` / `slotResolutionState`, and the plan's `serviceDate` /
   `pcoPlanId`. This is the human checkpoint.
5. If `--commit` is **absent**: stop here (exit 0). This is the safe default and
   mirrors the migration dry-run → apply workflow.
6. If `--commit` is **present**:
   - Refuse unless `ENABLE_PCO_INGESTION_WRITES=true` (the writer enforces this;
     the script should also fail loud with a clear message before calling it).
   - Call `persistIngestionPlan(plan)`; print the returned counts.
7. If `--verify` is present, run reconciliation and print PASS/FAIL per check.

### Guard rails

- Never default `--commit` on.
- The script must not read or write the PCO write transport (there is none) — it
  only reads from PCO and writes through the existing RPC writer.
- Keep all secrets server-side (service-role key, write flag); never log them.

## Reconciliation (`--verify`) — decision: service-role REST read

`psql` is not installed locally and the Supabase MCP may be absent in headless
runs, so reconciliation reads through the **service-role PostgREST API**
(`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), the same transport
the writer already uses. Add a small read helper (mirror the fetch/error
handling in `ingestion-writer.ts`).

Checks, comparing hosted state to the dry-run `plan.summary` for the ingested
`pcoPlanId`:

1. `ingest_runs` — exactly one row for this run with `status = 'ok'`.
2. `plans` — one row for `pcoPlanId`, `campus_id` = SLP.
3. `plan_times` — count matches `summary.planTimeCount`; the **9am** PlanTime
   resolved to the SLP 9am slot (`detected_slot_id` set, `slot_resolution_state`).
4. `items` — count matches `summary.itemCount`.
5. `item_times` — count matches `summary.itemTimeCount`.
6. `review_incidents` — open incident count matches `summary.incidentCount`,
   grouped by `kind` for a readable diff.

Print a table of expected vs actual; non-zero diff = FAIL with a non-zero exit.

## Testing

`scripts/ingest-weekend.test.ts` covers the orchestration boundary:

- Mocks `fetchLatestCompletedPlan` and `persistIngestionPlan`.
- Asserts dry-run mode never calls the writer.
- Asserts `--commit` without `ENABLE_PCO_INGESTION_WRITES=true` refuses before
  any write.
- Asserts a single-campus call shape and that returned counts are printed.

The writer and the RPC are already covered (23 unit tests, 42 pgTAP assertions).

## Operational runbook (step 4 / step 5)

1. `npm run ingest -- --campus SLP` → review the dry-run summary (no writes).
2. Set `ENABLE_PCO_INGESTION_WRITES=true` in the run environment only.
3. `npm run ingest -- --campus SLP --commit --verify` → write SLP's latest
   completed plan and reconcile (9am first, 11am also lands).
4. Return `ENABLE_PCO_INGESTION_WRITES` to `false`.
5. Spot-check the 9am slot end to end, then repeat for ELK / MG / LV.

The `ingest` package script runs the CLI with the React server condition so the
existing `server-only` imports remain enforced.

### Initial rollout status — 2026-06-24

- SLP: committed as ingest run 1 and fully reconciled (9am and 11am auto).
- ELK: committed as ingest run 2 and fully reconciled (9am and 11am auto).
- LV: committed as ingest run 3 and fully reconciled (10am auto).
- MG: committed as ingest run 4 and fully reconciled. Its 9am zero-length LIVE
  window and 11am incomplete LIVE bounds remain review-state evidence, not
  approved headline actuals.

Combined-title and song rollup candidates remain intentionally unmapped. Their
review evidence was persisted for the loaded campuses rather than
fabricating element-level precision.

## Recurring ingestion

`/api/pco/ingest` supports the GET request used by Vercel Cron and a POST for
manual triggers. Both use the same `CRON_SECRET` bearer authentication and
require `ENABLE_PCO_INGESTION_WRITES=true`. The route intentionally does not use
the development preview's production 404 gate.

`vercel.json` schedules the GET for `0 14 * * 1` (Monday 14:00 UTC). The runner
previews all four campuses before starting writes. A preview failure causes zero
writes; write results are reported per campus because the database transaction
boundary remains one whole PCO plan.

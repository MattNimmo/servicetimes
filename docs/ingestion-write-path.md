# Ingestion write path — implementation spec

Status: **ready for implementation** (2026-06-24). Scoped for codex to pick up.

## Why

`persistIngestionPlan` (`src/lib/pco/ingestion-writer.ts`) is the only code that
calls the atomic `ingest_pco_plan` RPC, and it currently has **no caller**. The
preview path (`previewLatestPcoIngestion` → `fetchLatestCompletedPlan` →
`buildIngestionPlan`) is fully wired but is GET-only, dev-only, and
`dryRun: true` end to end. There is no way to actually persist a weekend.

This slice adds the missing entry point so the first controlled production load
(roadmap step 4) can run, then reconciled (step 5).

## Decision: script first, route + cron later

Build a **server-side one-off script**, not a deployed route, for the first
load. Rationale: a write endpoint is premature surface area before a single
weekend has been validated by hand. The recurring product ingestion (an authed
POST route + Vercel Cron) is a **separate follow-up PR** — see "Deferred" below.

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

Run with `tsx` (or `node --import tsx`) against production env vars. Single-campus
per invocation (the RPC payload is single-campus).

### Arguments

| Arg | Default | Meaning |
| --- | --- | --- |
| `--campus <CODE>` | `SLP` | Campus code to ingest (first run: `SLP`). |
| `--commit` | absent | Without it, **dry-run only**: print the plan summary and exit 0 without calling the writer. With it, call `persistIngestionPlan`. |
| `--verify` | absent | After a commit (or standalone), run the reconciliation read (below) and print the comparison. |

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

Add `scripts/ingest-weekend.test.ts` (mirror `ingestion-writer.test.ts`):

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

Add an `ingest` script to `package.json` (`tsx scripts/ingest-weekend.ts`).

## Deferred to a follow-up PR (not in this slice)

- **Authed POST route + Vercel Cron** for recurring production ingestion. Open
  question to settle then: auth mechanism — Vercel `CRON_SECRET` (Bearer) for the
  scheduled path vs a shared-secret header for manual triggers. This route must
  **not** reuse the preview's `NODE_ENV === 'production' → 404` gate (it must run
  in prod) and therefore needs real auth instead.

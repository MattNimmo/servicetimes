# Ingest freshness fix — drop PCO `filter=past`, reschedule + add a repair backstop

**Operational amendment (2026-07-12):** Vercel Hobby provides per-hour cron
precision (±59 minutes), so the `19:00 UTC` primary is a `19:00–19:59` window,
not an exact trigger. The hardened production schedule adds an idempotent Sunday
retry at `20:05 UTC`, retains the Monday repair, emits structured request IDs and
schedule headers in runtime logs, and surfaces missing writes to operators on
Review. A second hardening pass now requires the exact expected Sunday, verifies
persisted 4/4 campus coverage before returning success, and adds an independent
GitHub Actions watchdog after the Sunday and Monday Vercel windows. The current runbook is
[`docs/ingest-operations.md`](ingest-operations.md).

Work order for how the weekly ingest finds "the latest completed service."
Self-contained; implement without the originating chat.

## Why (root cause, confirmed against live PCO on 2026-07-05, ~10 PM CT)

Two independent facts combine into the bug:

1. **The cron runs Sunday 20:00 UTC** = 3 PM CDT ([vercel.json](../vercel.json), `"0 20 * * 0"`).
2. **The selector asks PCO for `filter=past` only** ([fetch-plan.ts:23](../src/lib/pco/fetch-plan.ts), `fetchLatestCompletedPlan`).

Planning Center's `past`/`future` split is by **calendar date in the org's
local (Central) timezone**, independent of whether services are recorded:
`past` = dated before today, `future` = dated today or later. A plan dated
*today* stays in `future` until **local midnight**, even after the services
happen and the timers are entered hours earlier.

Evidence captured tonight (read-only):

| Location | July 5 in PCO | PCO bucket | Live timers recorded |
|----------|:--:|:--:|:--:|
| SLP | ✅ | `future` | ✅ complete |
| ELK | ✅ | `future` | ✅ complete |
| LV | ✅ | `future` | ✅ complete |
| MG | ✅ | `future` | ⚠️ 1 service not recorded yet |

Newest `past` plan for all four = **June 28**, so the Sunday-afternoon run can
never see the Sunday it just finished — it re-ingests the prior week. The data
is **systematically one week behind**. `recorded` (timers entered) and
`past`/`future` (calendar date) are orthogonal in PCO — hence the state you
spotted: recorded but still `future`.

## Product requirement — ready for Sunday evening

ECC services run 9 AM / 11 AM (10 AM at Lakeville) and finish by ~1 PM Central.
Pastors look at the dashboard Sunday evening, so the Sunday run must be the
primary path that gets the current weekend visible the same day. The Monday job
is a repair net for late/missed timers and ingestion errors; it is not allowed to
be the normal way Sunday data becomes visible.

That means Sunday ingestion should accept today's PCO plan once the service date
has arrived, and if a slot is incomplete it should ingest the plan with clear
review/blocked state rather than silently showing last week.

## Change 1 — Reschedule the Sunday run to 2 PM Central

- **File:** [vercel.json](../vercel.json)
- **Edit the existing entry:** `"schedule": "0 20 * * 0"` → `"schedule": "0 19 * * 0"`

`0 19 * * 0` = **19:00 UTC Sunday**. Vercel crons are fixed UTC (no DST), so:

| | Nov–Mar (CST) | Mar–Nov (CDT) |
|---|---|---|
| `0 19 * * 0` | 1:00 PM | **2:00 PM** |

Anchored on the current Sunday-evening need: during daylight time it lands at 2
PM Central, and in winter it lands at 1 PM Central. That winter run may be close
to the Lakeville / 11 AM finish, but the completed-service gate and repair
backstop cover late timers; the user has accepted that tradeoff to make Sunday
data available earlier.

## Change 2 — Stop using `filter=past`; select "today-or-earlier + recorded"

The real freshness guard already exists: a plan only qualifies if it has a
production service `plan_time` that is `recorded` **and** has real
`live_starts_at`/`live_ends_at` bounds ([fetch-plan.ts:30-38](../src/lib/pco/fetch-plan.ts)).
`filter=past` is redundant with that gate and actively hides today. Replace the
date filter with a "date has arrived" check and keep the gate.

- **File:** [fetch-plan.ts](../src/lib/pco/fetch-plan.ts) — `fetchLatestCompletedPlan` only.
- **Do NOT touch** `listPastPlansSince` / `fetchPlanBundleIfCompleted` (~line 68+);
  the historical backfill relies on them and Change 3 reuses them as-is.

**New selection logic:**

1. Fetch two windows for the service type:
   - newest already-past plans: `plans?filter=past&order=-sort_date&per_page=5`
   - nearest upcoming plans: `plans?filter=future&order=sort_date&per_page=5`
     (where PCO is hiding *today's* plan on a Sunday afternoon)
2. Keep only plans whose **`sort_date <= now`** (`Date.parse(sort_date) <= Date.now()`).
   `sort_date` is the early-morning run-through timestamp (UTC), so today's plan
   (~2:40 AM CT) is always ≤ a 2 PM run while next Sunday is always future.
   Clean today-vs-future split with no timezone library.
3. **De-dupe by plan id** (a boundary plan can appear in both windows) and sort
   by `sort_date` descending.
4. Run the **existing** completed-service loop over that list — first plan with
   at least one recorded, LIVE-bounded production service wins; fetch its items
   and return the same bundle shape. Do **not** require every configured slot to
   be complete before ingesting the plan. A partially complete plan should land
   on Sunday with review incidents / blocked actuals instead of leaving pastors
   on last week's dashboard.
5. If none qualify, throw the same "no completed service" error (callers handle
   it as `preview_failed`).

Effect: at 2 PM Sunday, a Location with at least one completed production service
resolves to **today**. If another slot is incomplete (MG 11 AM tonight), the plan
still lands and the ruleset surfaces that slot as incomplete/review-blocked. If a
Location has no completed production service at all, it falls back to the newest
recorded plan and Change 3 repairs it Monday.

## Change 3 — Monday 4 AM repair backstop for missing or incomplete data

A second cron, Monday morning, that captures anything the Sunday run missed
(late timers like MG) and acts as a general safety net. **It must only write
data that is missing or demonstrably incomplete — never churn a settled service.**

### Cron

- **File:** [vercel.json](../vercel.json) — add a second entry to `crons`:
  - `{ "path": "/api/pco/ingest/backfill", "schedule": "0 10 * * 1" }`
- `0 10 * * 1` = **10:00 UTC Monday** = 4 AM CST / 5 AM CDT. By then Sunday has
  rolled to `past` in PCO, so the plain `filter=past` backfill machinery sees it.
- Use the dedicated route as the primary design. Vercel cron examples document
  plain paths, not query-string dispatch, so avoid ambiguity here.

### Handler / mode

Share the auth/write guard between two route handlers:

- **default (Sunday):** existing `runRecurringPcoIngestion()` — newest completed
  plan per campus, idempotent upsert.
- **Monday backstop:** new route
  [ingest/backfill/route.ts](../src/app/api/pco/ingest/backfill/route.ts) calls
  `runRepairPcoIngestion({ weeks })`.

Keep the **same auth + write-flag gate** for both (`CRON_SECRET` bearer,
`ENABLE_PCO_INGESTION_WRITES==="true"`). Factor the guard into a shared helper so
both paths share it.

### `runRepairPcoIngestion({ weeks = 3 })` — fill missing, repair incomplete

- **File:** [recurring-ingestion.ts](../src/lib/pco/recurring-ingestion.ts) (new export).
- `sinceIso = today − weeks·7 days`.
- For each campus:
  1. `listPastPlansSince(serviceTypeId, sinceIso)` — reuse as-is (newest-first,
     stops at `since`).
  2. For each PCO plan, check the DB first by **PCO plan id**, not just
     `(campus_id, service_date)`. Add a small helper via the existing Supabase
     REST layer ([supabase/rest.ts](../src/lib/supabase/rest.ts)) that returns a
     freshness state for the exact plan:
     - `missing`: no `plans.pco_plan_id` row exists.
     - `complete`: the expected production slots for that campus have live bounds,
       item actuals are complete, and no open slot-blocking incidents remain.
     - `incomplete`: the plan exists but at least one expected production slot has
       incomplete item actuals, missing/zero live bounds, a reconciliation gap, or
       another open slot-blocking incident.
  3. **`complete` → skip**. This is the cheap normal Monday path and avoids
     re-touching settled weeks.
  4. **`missing` or `incomplete` → repair candidate.**
     - Run `fetchPlanBundleIfCompleted(serviceTypeId, plan)`.
     - If `skipped`, record the reason (timers still not recorded, no production
       service, etc.) and move on.
     - If `ok`, run `buildIngestionPlan(...)` + `persistIngestionPlan(...)`.
       This re-ingests raw PCO rows for the plan, but correction overlays remain
       preserved because plan-time/item-time corrections and mappings live in
       separate correction/override tables and the effective views reapply them.
       Do not delete correction rows, review history, or operator overrides.
- Return the same result shape as `runRecurringPcoIngestion` (per-campus
  `committed` / `skipped_complete` / `skipped_unqualified` / `write_failed`,
  plus `writesPerformed`).

Because the freshness check runs before the heavy fetch, a normal Monday (all
weeks complete) is cheap: one plan-list call + one lightweight DB freshness check
per candidate plan, then done. `weeks` is configurable; default 3 gives a small
backup window without walking history.

Idempotency note: the writer already preserves human overlays (raw PCO values
are superseded at the raw layer but admin corrections still win through
`active_*_corrections` and item/slot override tables). The freshness check is the
belt; the overlay-preserving writer is the suspenders — together the Monday run
can repair bad raw PCO pulls without disturbing hand-corrected data.

## Edge cases & guardrails

- **Partially recorded services** (MG's #2 tonight): Sunday ingest can write the
  plan if another production service is complete, but the incomplete slot stays
  review-blocked. Monday sees the existing plan as `incomplete`, re-fetches it,
  and repairs raw item/PlanTime data if PCO timers have been entered.
- **Totally unrecorded Locations:** Sunday falls back to the newest completed
  plan; Monday sees the missing Sunday plan and fills it once it qualifies.
- **Future weeks** (July 12+): no recorded bounds → skipped by the gate; the
  `sort_date <= now` filter is belt-and-suspenders, not the sole guard.
- **Non-production plan_times** (rehearsals): still filtered via `isNonProductionName`.
- **Write flag off in prod** → both crons 503 and write nothing; this is the
  first thing to check if data never lands (logs say so explicitly).
- **Clock skew:** `sort_date <= now` compares UTC on both sides; no tz math.

## Testing

- **Dry run (read-only):** `npm run ingest` (and `--campus ELK|LV|MG`). After
  Change 2, on/after a Sunday 2 PM CT this resolves to **today's** date for
  Locations with at least one completed production service, not last week's.
- **Backstop missing:** exercise `runRepairPcoIngestion` against a DB missing one
  PCO plan id — it writes only that one and skips the rest; run it twice to
  confirm the second run writes nothing once complete.
- **Backstop incomplete:** seed an existing plan whose 11 AM slot has incomplete
  item actuals / a reconciliation-gap incident, then make the PCO bundle complete;
  `runRepairPcoIngestion` re-ingests that plan and preserves active corrections.
- **Unit tests:** (1) selector prefers a `future`-bucketed *today* plan with
  recorded bounds over an older `past` plan, and ignores an unrecorded future
  plan; (2) freshness gating skips complete rows, repairs incomplete rows, and
  keys candidates by `pco_plan_id`.
- **Gates:** `npm run typecheck`, `npm run lint`, `npm test` (63 green today),
  `npx next build`.

## Rollout & verification

1. Ship Changes 1–3 together.
2. Confirm prod env on Vercel: `ENABLE_PCO_INGESTION_WRITES=true`, `CRON_SECRET`
   (≥16 chars). Confirm both cron entries appear in the Vercel “Crons” tab.
3. **Catch July 5 now:** immediately once Change 2 deploys, trigger once:
   `POST /api/pco/ingest` with `Authorization: Bearer <CRON_SECRET>`.
4. Then trigger the Monday repair route once if any campus/slot is incomplete:
   `POST /api/pco/ingest/backfill` with the same bearer token.
5. Verify in Vercel logs: `[pco-ingest] complete: ok=true writesPerformed=4`
   for the Sunday path. `writesPerformed=0` = nothing qualified (check recorded
   timers). For the repair path, expect `skipped_complete` for clean campuses and
   `committed` only for missing/incomplete plans.

## Decisions (locked)

- Sunday run: **`0 19 * * 0`** (1 PM CST / 2 PM CDT), chosen for Sunday-evening
  pastor readiness.
- Monday backstop: **`0 10 * * 1`** (4 AM CST / 5 AM CDT), repair missing or
  incomplete plans only.
- Backstop window default: **3 weeks** (tunable).

# Implementation plan — exclude the countdown from total service time

**Status:** Implemented locally on 2026-08-17; pending database-suite verification and deployment
**Author:** Investigation on 2026-08-17 (triggered by SLP 2026-08-16 showing no actuals)
**Decision owner:** Matt Nimmo
**Scope:** SQL migration + ingestion reconciliation + two query layers + one data migration

---

## 1. The rule

> The countdown video is never part of total service time. It is a countdown *to*
> the service, not a part of it.

This is a domain invariant, not a preference. Any measure of "service length"
must start at the first non-`pre_service` element.

## 2. The defect

Three different notions of service length exist today, and they disagree about
the countdown:

| Measure | Source | Countdown included? |
|---|---|---|
| Actual | `plan_times.actual_service_seconds` = `live_ends_at − live_starts_at` | **Yes** — wrong |
| Planned | `plan_times.planned_target_seconds` = `ends_at − starts_at` | No |
| Element analytics | `element_variance` | No (`sections.is_analytics_eligible = false` for `pre_service`) |

The "vs plan" delta on every card compares a countdown-**inclusive** actual
against a countdown-**exclusive** plan. Every delta in the system is inflated by
roughly one countdown.

### Root cause

`plan_times.live_starts_at` is written verbatim from PCO at
[`src/lib/pco/ingestion-plan.ts:505`](../src/lib/pco/ingestion-plan.ts). Operators
start the PCO LIVE clock when the countdown rolls, so `live_starts_at` lands on
the countdown's start — verified at **+0s in 11 of 11 services** across all four
campuses on 2026-08-16.

### Measured impact (2026-08-16, production)

| Campus | Planned | LIVE len | Service len | Countdown | Δ shown | Δ correct |
|---|---|---|---|---|---|---|
| ELK 9am | 72:30 | 74:41 | 69:41 | 5:00 | +2:11 | **−2:49** |
| ELK 11am | 72:30 | 76:02 | 71:01 | 5:01 | +3:32 | **−1:29** |
| LV 10am | 78:44 | 83:36 | 78:10 | 5:26 | +4:52 | **−0:34** |
| MG 9am | 73:30 | 81:52 | 77:00 | 4:52 | +8:22 | +3:30 |
| MG 11am | 73:30 | 87:00 | 82:10 | 4:50 | +13:30 | +8:40 |
| SLP 9am | 73:45 | 86:51 | 82:13 | 4:38 | +13:06 | +8:28 |
| SLP 11am | 74:25 | 91:35 | 86:39 | 4:56 | +17:10 | +12:14 |

Mean reported overrun **+8:57** → corrected **+4:00**. Elk River (both services)
and Lakeville flip from over to under.

## 3. Canonical definition

```
service_actual_seconds = live_ends_at − MIN(item_times.live_start_at)
                         WHERE the item's section_key
                               IS DISTINCT FROM 'pre_service'
```

Use `IS DISTINCT FROM`, not `<>`: `items.section_key` is nullable, and an
unmapped item is not thereby a countdown. The ingestion implementation must use
the same rule by excluding only item ids explicitly resolved to `pre_service`;
items with a null resolved section remain eligible. This keeps the SQL window
and the ingestion reconciliation identical when taxonomy is incomplete. Active
`item_bucket_overrides` are not part of this boundary calculation: ingestion
reconciliation operates on the normalized PCO bundle before database overrides
are read, so consulting overrides only in the view would create two definitions.

**Why the first real item's start, not "LIVE start + countdown length":** it is
the direct expression of the rule and it absorbs any dead air between countdown
end and worship start. On 2026-08-16 the two formulas agree to the second in all
seven services — the countdown ends exactly when the first real element begins —
but the window form stays correct if that ever stops being true.

**Why this cannot be fixed in the column:** `actual_service_seconds` is a
`generated always as ... stored` column
([`20260623193000_initial_service_times.sql:125`](../supabase/migrations/20260623193000_initial_service_times.sql)).
Generated columns may only reference their own row, so they cannot join to
`items` / `item_times`. The derivation must live in a view.

## 4. Changes

### 4.1 New migration — add the countdown-free window

Implemented in
[`supabase/migrations/20260817120000_service_window_excludes_countdown.sql`](../supabase/migrations/20260817120000_service_window_excludes_countdown.sql).

Extend `public.effective_plan_times` (current definition in
[`20260625150000_non_production_exclusion_rules.sql`](../supabase/migrations/20260625150000_non_production_exclusion_rules.sql))
with a lateral subquery producing `service_actual_seconds`.

Constraints on the edit:

- **Append the new column last**, after `is_manually_excluded`. `create or
  replace view` requires existing columns to keep their name, type, and
  position; new columns may only be appended.
- The view selects `pt.*`, so `actual_service_seconds` **remains available**.
  That is deliberate — it preserves the true broadcast start for provenance —
  but it means nothing breaks silently if a consumer is missed. See §4.3.
- Keep `with (security_invoker = true)`.
- Preserve the existing grants.

Fallback behaviour, in order:

1. If `live_ends_at` is null → return null. Make this an outer `case` before
   clamping; PostgreSQL `greatest(0, null)` returns `0`, not null.
2. If any item timer whose item's section is not `pre_service` has a
   `live_start_at` → use `live_ends_at − MIN(that live_start_at)`, clamped to
   `>= 0`.
3. Else, if any `pre_service` item timer exists → return `0`. The only observed
   timers are countdown timers, so no part of the LIVE window is known to be
   service time (pt 24 in §4.4).
4. Else → fall back to `actual_service_seconds` (no item timers at all; pt 25
   in §4.4).

Implement these as distinct branches rather than a single `coalesce`, so the
only-pre-service and no-timers cases cannot collapse into one another.
Only consider items with `seen_in_last_pull = true`; ingestion reconciles the
current PCO bundle, so a timer attached to an item removed by a later pull must
not move the SQL boundary.

Add a comment on the column stating the rule and pointing at this document.

### 4.2 Reconciliation check — MUST change in the same commit

**This is the trap. Do not ship 4.1 without 4.2.**

[`src/lib/pco/ingestion-plan.ts:625–653`](../src/lib/pco/ingestion-plan.ts) sums
*every* item timer — countdown included — and compares it against
`actualServiceSeconds`, opening a `reconciliation_gap` when
`Math.abs(gapSeconds) > 1`.

`reconciliation_gap` is a **slot-blocking** kind
([`src/lib/variance/queries.ts:75`](../src/lib/variance/queries.ts)), so it
suppresses every actual for that slot.

If the service window shrinks by ~5 min while the sum still includes the
countdown, the gap at SLP 9am moves from −42s to about −320s, and **every service
at every campus opens a slot-blocking incident** — the whole app goes to "Needs
review."

Required changes to that block:

1. Build a set of `pcoItemId`s whose resolved `section_key` is exactly
   `pre_service` (derive it from the already-resolved `items` list in the same
   function — do not re-infer from titles). A null `section_key` is not
   pre-service and must remain eligible, matching §3's `IS DISTINCT FROM`
   semantics.
2. Exclude those from `matching` / `completed` / `summedActualSeconds`.
3. Compare against the **countdown-free window** (§3), not
   `planTime.actualServiceSeconds`.
4. Exclude pre-service item ids from the incident's `itemIds` payload, so
   element-level blocking never implicates the countdown.
5. Extend the recorded `evidence` with the excluded pre-service seconds, so a
   future reader can reconstruct the arithmetic.

**Verification target:** SLP 9am 2026-08-16 must still compute a gap of
**−42s** after this change (window 4933s vs non-pre-service sum 4975s). That −42s
is a genuine discrepancy unrelated to the countdown — it must survive, or the
change has hidden a real signal. Do not "fix" it here.

Update the existing reconciliation tests at
[`src/lib/pco/ingestion-plan.test.ts:175`](../src/lib/pco/ingestion-plan.test.ts)
and `:338`.

### 4.3 Switch consumers

Audit every reference to `actual_service_seconds` and decide, per site, whether
it wants the true broadcast window or the service length. Default: **service
length**.

| File | Notes |
|---|---|
| [`src/lib/variance/queries.ts`](../src/lib/variance/queries.ts) | `EffectivePlanTime` type, both `readRows` selects (`listServiceDates`, `getVarianceDashboard`), and both `computeVariance` call sites. Drives the cards in the screenshot. |
| [`src/lib/instrument/queries.ts`](../src/lib/instrument/queries.ts) | Switch every service-total read and type: Glance `EffectivePlanTimeRow` plus ~`:248`/`:306`; Workbench ~`:964`/`:971`/`:1008`; historical trend ~`:1059`/`:1069`/`:1154`; Triage `TriagePlanTimeRow` plus ~`:1219`/`:1321`. Each should select/read `service_actual_seconds`, while continuing to prefer `active_plan_time_corrections.corrected_actual_seconds` wherever that preference exists today. **Do not change** genuine broadcast timestamps: Glance ~`:307`, Workbench ~`:1035–1037`, and the bumper-end → message-end helper around `:402–495` stay on item timer bounds with `live_starts_at` / `live_ends_at` only as their existing fallback. |
| [`supabase/migrations/20260702170000_backfill_quality.sql`](../supabase/migrations/20260702170000_backfill_quality.sql) | Recreate `public.backfill_quality` in the new migration; do not edit the already-applied migration. Use `service_actual_seconds`, join `item_timer_sums` through `items`, and exclude rows where `items.section_key = 'pre_service'` using the same `IS DISTINCT FROM` semantics as §3, so `reconciliation_gap_seconds` moves in lockstep with §4.2. Preserve item-time corrections, `pco_exclude`, the current grade thresholds, security-invoker setting, revokes, and grant. |

`element_variance` needs **no change** — it never reads
`actual_service_seconds` and already excludes `pre_service` via
`is_analytics_eligible`.

`20260701130000_reference_plan_changes.sql` is historical only. Its
`generate_reference_plan_changes` function was dropped and replaced by
`generate_planned_item_plan_changes` in the next migration
([`20260701140000_planned_item_plan_changes.sql`](../supabase/migrations/20260701140000_planned_item_plan_changes.sql)).
The replacement operates entirely on element variance and requires no service
window change. Do not resurrect the retired reference-target function.

### 4.4 Data migration — the 5 existing corrections

`active_plan_time_corrections` holds 5 rows whose `corrected_actual_seconds` were
entered against the countdown-**inclusive** window. **Decision: auto-adjust in
the migration.** Recompute each to the canonical definition, clamped at 0.

| plan_time | current | pre-service | new window | target | action |
|---:|---:|---:|---:|---:|---|
| 24 | 0:00 | 5:00 | −5:00 | **0:00** | no change — degenerate, clamp |
| 25 | 75:30 | 0:00 | n/a | **75:30** | no change — no pre-service timer |
| 458 | 88:15 | 3:37 | 84:38 | **84:38** | adjust |
| 1747 | 86:51 | 4:38 | 82:13 | **82:13** | adjust (SLP 9am, 2026-08-16) |
| 1748 | 91:35 | 4:56 | 86:39 | **86:39** | adjust (SLP 11am, 2026-08-16) |

Rules:

- Only 3 of 5 rows change. Write the migration so 24 and 25 are provably
  untouched rather than incidentally unchanged.
- For each of plan times 458, 1747, and 1748, proceed only when its active value
  still matches the `current` column above (guarding against touching unrelated
  or already-rebased data). Lock that correction and its incident, calculate
  `max(revision) + 1`, mark the current
  `correction_sets` row `superseded` with `status_changed_at = now()`, then insert
  a **new active `correction_sets` revision** and its new `correction_values`
  row. Do this atomically in the migration. The partial unique index
  `correction_sets_one_active_revision` permits only one active set per incident,
  so the supersede must happen before the insert. Do not mutate old
  `correction_values`; revisioning in
  [`20260624050000_plan_time_corrections.sql`](../supabase/migrations/20260624050000_plan_time_corrections.sql)
  preserves the audit trail. Use an actor string that identifies this migration,
  not `operator`.
- Write an `admin_audit_log` row, matching the pattern the existing correction
  functions use, with both the superseded correction set/value and the new
  correction set/value reconstructible from `before_state` / `after_state`.
- Leave the incidents at `corrected`. Do **not** reopen them — reopening would
  re-block those five slots.

## 5. Edge cases to handle explicitly

| Case | Example | Required behaviour |
|---|---|---|
| No item timers at all | pt 25 | Fall back to `actual_service_seconds`; do not null out |
| Only pre-service timers exist | pt 24 | Return 0; do not fall back to the countdown-inclusive LIVE window |
| `live_ends_at` null | `missing_live_bounds` incidents | Stay null, as today |
| First real item has null `section_key` | unmapped item | Treat it as non-pre-service (`IS DISTINCT FROM` semantics) so SQL and ingestion agree |
| Countdown not first / mid-service pre-service item | none observed | `MIN` over all non-pre-service starts already handles it |
| Dead air between countdown and worship | none on 2026-08-16 | Window form absorbs it — this is why we use it |
| Item timer starting before `live_starts_at` | not observed | Window may exceed the LIVE window; allow it, do not clamp to `actual_service_seconds` |

## 6. Testing

- **Unit** — reconciliation in `ingestion-plan.test.ts`: a plan with a countdown
  must produce **no** incident when the non-pre-service timers tile the service
  window, and must still produce one for a genuine gap.
- **Regression, named explicitly** — SLP 9am 2026-08-16: service window 4933s,
  non-pre-service sum 4975s, gap **−42s**, incident still opens.
- **SQL** — add to `supabase/tests/database/` covering every branch in §4.1:
  normal non-pre-service window, negative-window clamp, only-pre-service timers,
  no timers fallback, null `live_ends_at`, and a first real item with null
  `section_key`. The only-pre-service fixture must have a positive raw LIVE
  window so it proves the result is 0 because of the rule, not incidentally.
- **Post-migration correction verification** — run read-only SQL against the
  deployment database and assert plan times 458, 1747, and 1748 each have one
  superseded old set plus one active new revision with the exact targets; assert
  plan times 24 and 25 have no new correction set, value, or audit row; assert
  all five incidents remain `corrected`. Keep this production-data check
  separate from `supabase/tests/database/`, whose fresh database does not
  contain these five production rows.
- **Cross-check** — after migrating, `element_variance` element sums and the new
  `service_actual_seconds` should be closer than before (SLP 9am: 4975 vs 4933,
  a 42s gap instead of 278s). They will not be equal; the residual is the real
  reconciliation discrepancy.
- **Full-table sanity** — recompute the §2 table from production and confirm all
  seven rows match the "Δ correct" column.

## 7. Rollout

1. Migration + code in one commit — §4.1 and §4.2 must be reviewed and released
   together, but deploy order still matters.
2. Deploy the **database migration first** with `npx supabase db push`. Adding
   `service_actual_seconds` is backward-compatible with the currently deployed
   app, which will continue reading `actual_service_seconds` during this short
   interval. Re-run the §2 query and diff against the table above.
3. Deploy the **application code second**. Never deploy code that selects
   `service_actual_seconds` before the database column exists. Once this deploy
   completes, the new ingestion reconciliation and every service-total consumer
   switch together.
4. **No cache invalidation needed.** Next.js is 16.2.9 and every relevant route
   is `export const dynamic = "force-dynamic"` (viewer and instrument layouts,
   all instrument pages). Numbers change on next request.
5. Confirm the Verify queue count does not jump. A spike means §4.2 is wrong —
   roll back rather than bulk-resolving.
6. Spot-check SLP 2026-08-16: 9am should read 82:13 actual against 73:45 planned
   (+8:28), not 86:51 / +13:06.
7. Notify downstream report readers that all historical service-total deltas and
   trend baselines move by roughly one countdown as soon as the application
   deploy completes. This is an intentional correction of historical values,
   not a new discontinuity in service behavior.

## 8. Out of scope — track separately

- **The ±1s reconciliation tolerance.** `Math.abs(gapSeconds) > 1` on an
  ~85-minute service is 0.02%. It has opened **17 open `reconciliation_gap`
  incidents** since 2025-07-06, roughly one a month, each blocking a full
  service until an operator clicks Save. Worth deciding whether sub-minute gaps
  should be recorded without slot-blocking. Not part of this change.
- **The −42s / +42s SLP pair.** 2026-08-16 9am was −42s and 11am was +42s —
  equal and opposite, which suggests 42s attributed to the wrong service at the
  boundary. Independent of the countdown; survives this fix by design.
- **Maple Grove announcements.** MG runs no `Announcements` item most weeks
  (mid-service is Meet & Greet → Hosted Moment → KB 5 spot → Offering), so it
  has announcement data on only 4 dates in 12+ months. Any cross-campus
  announcements comparison should report MG as n/a rather than a median over
  n=1–3.

## 9. Note for whoever picks this up

Per [`AGENTS.md`](../AGENTS.md), this repo runs a Next.js version with breaking
changes relative to model training data — read the relevant guide under
`node_modules/next/dist/docs/` before writing app-router code. This change is
confined to SQL and `src/lib/**` (server-only data access) and should require no
Next.js API surface changes; if that turns out to be wrong, read the guide
first.

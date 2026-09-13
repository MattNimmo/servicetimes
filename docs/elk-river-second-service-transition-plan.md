# Elk River second-service schedule transition plan

**Status:** Production rollout in progress; database migration applied

**Effective date:** Sunday, August 30, 2026

**Decision:** Elk River's second service moved from 11:00 AM to 10:30 AM and
will remain at 10:30 AM for the foreseeable future. It remains the same logical
second service and must be compared with the 11:00 AM second services at Spring
Lake Park and Maple Grove.

## Execution record — September 13, 2026

Implemented in the current workspace:

- stable `first` / `second` slot identity and date-effective schedules;
- the forward Supabase migration, deterministic seed updates, stable-key RPC
  compatibility wrapper, historical variance labels, and shared completeness
  view;
- August 30-aware ingestion, stable comparison cohorts, canonical Workbench
  URLs, missing-service placeholders, and unresolved-service Verify work;
- recurring-ingest and watchdog health based on the same persisted completeness
  result;
- TypeScript, application, migration-contract, and operational documentation
  updates.

Read-only production inventory confirmed that Elk River's existing second slot
is ID `2`, still labeled `11am`, and has no active manual resolution, PlanTime
correction, ItemTime correction, or plan change for the affected dates. August
30 and September 6 each currently have an unresolved 10:30 second-service
PlanTime, with two PlanTime-scoped and two plan-scoped open slot-resolution
incidents in total.

The live PCO dry-run covered August 23, August 30, and September 6: all three
plans were ingestable, none was skipped, and no production PlanTime had a slot
resolution failure under the new configuration. The linked Supabase migration
dry-run identified only
`20260913090000_service_slot_schedule_identity.sql`; it was then applied to
production and read back successfully. Slot ID `2` remained intact, and both
date-effective schedule ranges are present.

Application verification is green: typecheck, 126 unit tests, lint, and the
production build pass. Local migration execution, pgTAP, and database lint
could not run because no Docker-compatible runtime is installed. The hosted
migration executed successfully despite the local-runtime limitation. App
deployment and targeted production re-ingestion remain in progress.

## Objective

Represent a service's stable identity separately from the clock time at which
it meets. Preserve historically accurate labels, automatically ingest Elk
River's 10:30 AM PlanTime beginning August 30, keep its trend continuous with
the former 11:00 AM service, and include it in the cross-location second-service
comparison.

This work also closes the operational gaps exposed by the schedule change:

- an unresolved service can currently disappear from normal dashboards and
  Verify;
- Workbench silently falls back to the first service when a slot label is not
  valid for the selected location;
- recurring-ingest and watchdog health can count a location as successful when
  it merely has a persisted plan, even if a production service is unresolved or
  incomplete.

The cron times do not need to change. Elk River now finishes earlier, and the
existing Sunday primary, retry, Monday repair, and independent watchdog windows
remain suitable.

## Product behavior to preserve

1. A service is identified as `first` or `second`; its displayed time is a
   date-effective schedule attribute.
2. Elk River dates through August 23, 2026 display `11am` for the second
   service.
3. Elk River dates beginning August 30, 2026 display `10:30am` for the second
   service.
4. Elk River's second-service trend continues across the transition instead of
   starting a new series on August 30.
5. Cross-location comparisons use service identity:
   - `first`: SLP 9am, ELK 9am, MG 9am, and LV 10am;
   - `second`: SLP 11am, ELK 10:30am, and MG 11am; Lakeville has no second
     service and remains absent from this cohort.
6. Historical pages always show the time that applied on that service date,
   not the location's current time.
7. Existing corrections, incident resolutions, plan changes, and item timing
   history remain attached to the same stable database slot IDs.

## Why a label-only change is insufficient

Today `service_slots.slot_label` acts as all of the following:

- a display label;
- the ingestion lookup key;
- a URL/navigation value;
- a comparison cohort selector; and
- the label joined onto historical analytics.

Updating the Elk River row from `11am` to `10:30am` would preserve foreign keys
but retroactively relabel all history. Inserting a second row would preserve the
old label but split trends, complicate corrections, and leave inactive-slot
history hidden by queries that read only active slots. The implementation must
therefore introduce a stable identity rather than choosing either shortcut.

## Target data model

### Stable slot identity

Add a non-null `slot_key` to `public.service_slots`, unique within a campus.
Use the values `first` and `second` for production services. Backfill the seven
existing production rows without changing their IDs:

| Location | Existing slot | `slot_key` |
|---|---:|---|
| SLP | 9am | `first` |
| SLP | 11am | `second` |
| ELK | 9am | `first` |
| ELK | 11am | `second` |
| MG | 9am | `first` |
| MG | 11am | `second` |
| LV | 10am | `first` |

Keep `slot_label`, `expected_local_start`, and
`match_tolerance_minutes` temporarily as legacy compatibility columns. New
application code must not use `slot_label` as identity. Do not create a new Elk
River service-slot row and do not change the existing second-service row ID.

### Date-effective schedules

Add `public.service_slot_schedules` with:

- `id bigint` primary key;
- `slot_id bigint not null references public.service_slots(id)`;
- `effective_during daterange not null`, using half-open `[start, end)` ranges;
- `display_label text not null`;
- `expected_local_start time not null`;
- `match_tolerance_minutes integer not null`, retaining the existing 0–60
  validation;
- `created_at timestamptz` and optional `created_by text` for provenance.

Prevent overlapping ranges for the same `slot_id`. Use an exclusion constraint
or an equivalent trigger covered by database tests. There must be exactly one
effective schedule for every active production slot on any service date the app
supports.

Seed one open-ended schedule for every unchanged service. Seed two schedules
for Elk River's second service:

| Effective range | Display label | Expected start | Tolerance |
|---|---|---:|---:|
| before 2026-08-30 | `11am` | 11:00 | 10 minutes |
| from 2026-08-30 onward | `10:30am` | 10:30 | 10 minutes |

Use August 30 as the exact inclusive boundary. With `[start, end)` ranges, the
legacy range ends at `2026-08-30` and the new range begins at `2026-08-30`.

Add a small SQL function or view that resolves a slot's schedule for a supplied
service date. Reuse that contract in historical views instead of independently
reimplementing date-range joins.

### Deterministic configuration

Create a new forward-only Supabase migration. Do not edit already-deployed
migration history. Update `supabase/seed.sql` so a clean reset produces the same
stable slot keys and schedule rows as production.

The migration must be idempotent where practical and must verify that the
existing ELK second-service slot was found before updating or inserting
schedule data. It must fail loudly rather than create a duplicate slot.

## Ingestion changes

### Effective schedule selection

Refactor the slot definitions in `src/lib/pco/campuses.ts` around stable keys and
date-effective schedules. The in-code deterministic configuration mirrors the
database configuration because the pure ingestion planner must resolve slots
before persistence.

Calculate the plan's Chicago service date before assigning PlanTimes. Pass that
date into slot assignment and select the one schedule effective on that date.
Match `starts_at` against that schedule's `expectedLocalStart` and tolerance.

Required boundary behavior:

- ELK 11:00 on 2026-08-23 resolves to `second`;
- ELK 10:30 on 2026-08-30 resolves to `second`;
- ELK 10:30 before the transition does not silently resolve;
- ELK 11:00 after the transition does not silently resolve unless it falls
  within a deliberately configured tolerance.

### Payload and database lookup

Add `detectedSlotKey` to persisted PlanTime payloads and `slotKey` to
slot-scoped incidents. Update `ingest_pco_plan` to resolve a slot by
`campus_id + slot_key`.

Keep temporary fallback support for the old `detectedSlotLabel` and
incident `slotLabel` fields so the additive database migration is compatible
with an app instance still finishing an older deployment. New code and tests
must use the key fields. Record the removal of legacy payload support as a
separate later cleanup; it is not required for this rollout.

Update ingestion verification to compare stable keys. Human-readable logs and
incident details should include the date-effective display label and expected
start so operators still see `10:30am`, not `second`, as the primary wording.

### Re-ingestion and incident supersession

After deployment, run targeted previews for Elk River on August 30 and every
later Sunday already present in production. At the time of this plan that
includes at least August 30 and September 6, 2026.

Then re-ingest those dates through the existing atomic writer. Expected
effects:

- previously unresolved 10:30 PlanTimes acquire the existing Elk River
  `second` slot ID;
- item timers and source provenance remain intact;
- stale slot-resolution incidents are superseded by the normal ingestion
  incident lifecycle;
- manual corrections and plan changes tied to the existing slot ID remain
  valid.

Do not bulk rewrite already-correct PlanTime timestamps or timing corrections.

## Query and presentation changes

### One schedule resolver

Return these concepts distinctly from server queries:

- `slotKey`: stable identity (`first` or `second`);
- `slotLabel`: display label effective for the relevant service date;
- `expectedLocalStart`: expected start effective for that date.

For latest/current selectors, resolve the schedule against the latest displayed
service date. For historical variance, trend tooltips, and Verify, resolve it
against each plan's own `service_date`.

Update the latest definitions of `element_variance`, `backfill_quality`, and any
other view that currently selects `service_slots.slot_label` so they return the
date-effective label. Recreate dependent views in dependency-safe order in the
new migration. Leave historical migration files unchanged.

### Workbench URLs and location switching

Keep the existing `slot` query parameter name, but make its canonical value the
stable key:

- `slot=first`
- `slot=second`

Accept legacy aliases (`9am`, `10am`, `10:30am`, and `11am`) at the route
boundary, resolve them to the selected location's stable key, and replace the
URL with its canonical form. Old Elk River `slot=11am` bookmarks must land on
`slot=second`, not silently fall back to 9am.

When switching locations, preserve the stable key. This naturally maps SLP or
MG `second` to ELK `second`. If the destination does not offer that identity
(for example, switching a second service to Lakeville), explicitly select its
first available service and canonicalize the URL. Never render data from a
fallback slot while leaving a different slot selected in component state.

### Cross-location comparison

Replace `resolveMidComparisonSlotLabel` with identity-based comparison logic.
The comparison lookup should find `service_slots.slot_key` equal to the active
slot key and use each location/date's effective display label only for copy.

This removes special-case label translation from the analytics query:

- Lakeville 10am joins the other locations' 9am services because each is
  `first`;
- Elk River 10:30am joins SLP and MG 11am because each is `second`.

The comparison heading may continue to show the active location's effective
label, but accessible summaries should include each location's actual label
when labels differ.

### Historical and current surfaces

Update all places that display or select a service:

- Review / Glance cards and trend legends;
- Workbench selectors, headings, links, and trend context;
- Verify slot headers, mapping choices, and plan-clock calculations;
- At a glance historical service cards and element detail;
- backfill and ingestion reports that emit `slot_label`.

Acceptance examples:

- ELK on 2026-08-23 displays `11am`;
- ELK on 2026-08-30 displays `10:30am`;
- an ELK second-service 6- or 12-week trend contains points from both sides of
  the change;
- the August 30 Verify plan clock anchors the second service at 10:30.

## Make unresolved services visible

The schedule fix prevents this specific mismatch going forward, but Verify
must also expose future configuration drift.

Update Verify data loading so production PlanTimes with
`effective_slot_id is null` are not discarded. Render them in an "Unresolved
service" section with their PCO name and start time, plus the existing map or
exclude actions. Include plan-scoped missing-slot incidents as actionable work;
today Verify reads only incidents attached to already-resolved PlanTimes.

Review and At a glance should build the expected service list from the schedule
effective on the plan date. If an expected service is absent or unresolved,
render a blocked/needs-review placeholder instead of presenting the location as
though it had fewer services.

Viewer copy must remain plain and avoid exposing internal keys. Operators may
see the underlying reason in Verify.

## Ingestion health and watchdog hardening

Replace plan-presence counting with one shared definition of a complete
location/date. A location is complete only when:

1. a plan exists for the expected service date;
2. every production slot identity effective for that date has exactly one
   non-excluded service PlanTime;
3. each expected PlanTime has LIVE start and end bounds;
4. tracked element actuals are complete; and
5. no open slot-blocking incident remains.

Use this same completeness result for:

- the per-location retry decision;
- the recurring-ingest final `successfulLocations` count and `ok` value;
- `/api/pco/ingest/watchdog` health;
- operator freshness status on Review.

Do not count a campus merely because `plans` has a row for the Sunday. A
persisted plan with an unresolved 10:30 service must keep the run and watchdog
non-green, while still preserving successful writes for the other locations.

Return safe per-location reasons such as `expected 2 services, found 1` or
`second service unresolved` in structured logs. Preserve the existing
campus-isolated write behavior and HTTP failure signal when fewer than four
locations are complete.

## Test plan

### TypeScript unit tests

Add or update tests for:

- schedule selection immediately before and on the August 30 boundary;
- ELK 10:30 PlanTime resolution and incident-free payload generation;
- stable `first`/`second` comparison cohorts in both navigation directions;
- Lakeville's absence from the second-service cohort;
- legacy Workbench URL alias canonicalization;
- campus switching while `slot=second`;
- no silent first-service fallback for an invalid key;
- historical display labels and expected starts;
- recurring ingest remaining incomplete when a plan exists but one expected
  service is unresolved;
- watchdog health using the same completeness definition;
- Verify returning unresolved service PlanTimes and plan-scoped slot incidents.

### Database tests

Extend pgTAP coverage to prove:

- seven stable production slot rows still exist;
- the existing ELK second-service slot ID is retained;
- schedule ranges for a slot cannot overlap;
- exactly one schedule resolves for ELK on 2026-08-23 and 2026-08-30;
- historical views label those dates `11am` and `10:30am`, respectively;
- the ingestion RPC resolves `detectedSlotKey=second` to the existing slot;
- legacy payload fallback works during rollout;
- existing corrections, manual slot resolutions, and plan changes remain
  attached after the migration;
- unresolved or blocked services do not satisfy freshness.

### Verification commands

Run the full project checks documented in `package.json`, including at minimum:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run db:reset
npm run db:test
npm run db:lint
```

Before changing Next.js route or navigation code, read the applicable guide in
`node_modules/next/dist/docs/` as required by the repository instructions.

## File map

Expected implementation areas include:

- `src/lib/pco/campuses.ts` — stable keys and effective schedule definitions;
- `src/lib/pco/ingestion-plan.ts` — service-date-aware slot assignment;
- `src/lib/pco/ingestion-verifier.ts` — verify stable slot keys;
- `src/lib/pco/recurring-ingestion.ts` and `src/lib/pco/ingest-health.ts` —
  shared complete-location verification;
- `src/lib/instrument/queries.ts` and `src/lib/variance/queries.ts` — effective
  schedule reads, comparison identity, unresolved-service visibility;
- `src/app/(instrument)/instrument/workbench/page.tsx` and instrument
  components — canonical slot-key navigation and display labels;
- the viewer variance pages — historical labels;
- `supabase/seed.sql` — deterministic keys and schedules;
- a new Supabase migration — additive schema, data backfill, RPC/view updates;
- TypeScript and pgTAP tests covering the cases above;
- `README.md` and `docs/ingest-operations.md` — current schedule vocabulary and
  operational verification.

Do not rewrite historical build-plan documents merely to replace old 11am
examples; update only current source-of-truth documentation unless a historical
statement is actively misleading about present behavior.

## Rollout order

1. Take a read-only production inventory of the existing ELK second-service
   slot ID, PlanTimes on and after August 30, active manual resolutions,
   corrections, plan changes, and open slot-resolution incidents.
2. Add database tests and the forward migration. The migration must remain
   compatible with the currently deployed payload during the rollout window.
3. Implement stable-key ingestion, effective schedule queries, navigation,
   comparison, unresolved-service visibility, and health hardening.
4. Run the full local application and database verification suite.
5. Apply the migration to the hosted project and verify seeded schedules and
   unchanged slot IDs.
6. Deploy the application.
7. Run ELK dry-run previews for August 23, August 30, September 6, and the latest
   available Sunday. Confirm the boundary behavior and compare planned write
   counts with production.
8. Re-ingest August 30 and later affected ELK plans through the atomic writer.
9. Verify Review, Workbench, Verify, At a glance, recurring health, and
   watchdog health against production data.
10. Monitor the next Sunday run. It must resolve ELK 10:30 automatically,
    compare it with SLP/MG 11am, and finish with four complete locations.

## Acceptance criteria

The change is complete when all of the following are true:

- August 30, 2026 and later ELK 10:30 PlanTimes automatically map to the stable
  second-service slot.
- ELK's pre-transition and post-transition second-service data form one trend.
- Historical dates show `11am`; dates from August 30 forward show `10:30am`.
- The ELK 10:30 mid-service comparison includes SLP and MG 11am, and those
  locations' second-service comparisons include ELK 10:30.
- Old `slot=11am` ELK links resolve and canonicalize to `slot=second` without
  showing 9am data.
- Switching locations preserves first/second identity wherever available.
- An unresolved production PlanTime is visible and actionable in Verify and
  produces a blocked placeholder on viewer surfaces.
- Recurring ingestion and the watchdog cannot report success based only on a
  persisted plan row.
- Existing slot-linked corrections, resolutions, recommendations, and history
  remain intact.
- Cron schedules remain unchanged.
- Typecheck, unit tests, lint, production build, database reset, pgTAP, and
  database lint all pass.

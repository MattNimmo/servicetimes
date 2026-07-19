# Sunday ingest campus-isolation implementation plan

Status: **Ready for implementation**

## Objective

Make every Sunday ingest attempt independent by location. A preview, timekeeping,
qualification, or database-write failure at Spring Lake Park (SLP), Maple Grove
(MG), Elk River (ELK), or Lakeville (LV) must not prevent the other qualified
locations from being written.

This change applies to all callers of the recurring Sunday ingest:

- the Vercel Sunday primary cron;
- the Vercel Sunday retry cron;
- the independent Sunday watchdog recovery call; and
- a manually authorized call to `/api/pco/ingest`.

The Monday repair already continues after a location or plan failure. Preserve
that behavior. This plan removes the Sunday-only all-or-nothing preview gate so
both paths have the same location-isolation guarantee.

## Problem in the current implementation

`runRecurringPcoIngestion()` in
[`src/lib/pco/recurring-ingestion.ts`](../src/lib/pco/recurring-ingestion.ts)
currently does the following:

1. Preview all four locations with `Promise.allSettled`.
2. Check whether any preview rejected or returned the wrong service date.
3. If any one preview is invalid, return immediately with
   `writesPerformed: 0`.
4. Only persist plans when all four previews pass.

This protects against stale fallback data, but it also couples unrelated
locations. For example, MG having no completed production service prevents valid
SLP, ELK, and LV plans from being written. The same coupling would occur if SLP,
ELK, or LV were the failing location.

The write phase is already closer to the desired model because it uses
`Promise.allSettled`: one failed persistence call does not roll back other
fulfilled location writes. The preview phase must gain the same isolation.

## Locked behavior

The implementation must satisfy all of these rules:

1. **Isolation is generic.** Do not special-case MG or any other campus code.
   The same pipeline and error handling apply to every entry in `PCO_CAMPUSES`.
2. **The expected-date safeguard remains.** Calculate the expected Chicago
   Sunday once per invocation. A location preview may be written only when its
   `plan.serviceDate` exactly matches that date.
3. **A stale location is rejected locally.** A stale or wrong-date preview must
   never be persisted, but it must not block valid locations.
4. **Qualification rules remain unchanged.** Do not loosen the existing
   `buildCampusPlan()` requirements or synthesize times when Planning Center has
   no qualified completed production service. Missing MG time in the July 12
   incident is an acceptable local result; losing the other three locations is
   not.
5. **Writes remain atomic per location.** Retain the existing ingestion-writer
   transaction/RPC boundary. Do not create a cross-location transaction and do
   not roll back successful location writes when another location fails.
6. **Partial completion remains an overall failure signal.** Successful writes
   stay committed, but the route returns `ok: false` while final persisted
   coverage is below four of four. `runSecuredPcoIngest()` should continue to
   translate that result to HTTP 502 so the retry/watchdog and operator alert
   remain active.
7. **Overall success is based on final persisted coverage.** Return `ok: true`
   only when verification finds all expected locations for the expected Sunday.
   The number of writes in the current invocation is not the success criterion;
   a retry may reach four-of-four after writing only one missing location.
8. **Retries are safe and targeted.** A complete location should not be
   rewritten on every retry. Missing or incomplete locations should be retried.
9. **Process every location.** One location exception must never escape early
   and prevent remaining location results from being collected.
10. **Do not hide failures.** Return and log a result for every location with a
    stage-specific status and a safe error message.

## Target execution model

Replace the global preview gate with a self-contained per-location operation.
The recurring ingest should orchestrate four independent promises and wait for
all of them:

```text
expected Chicago Sunday
        |
        +-- SLP: check -> preview -> date gate -> write -> result
        +-- MG:  check -> preview -> date gate -> write -> result
        +-- ELK: check -> preview -> date gate -> write -> result
        +-- LV:  check -> preview -> date gate -> write -> result
        |
        +-- verify final persisted coverage -> overall response
```

Use `Promise.all` around a helper that catches and converts its own errors, or
use `Promise.allSettled` and normalize every settlement. The important contract
is that no campus rejection can terminate the shared operation.

### Per-location algorithm

For each entry in `PCO_CAMPUSES`:

1. Read the persisted state for that campus and the expected service date.
2. If it is complete, return `skipped_complete` without calling Planning Center
   or the writer.
3. If it is missing or incomplete, call
   `buildCampusPlan(campus, expectedServiceDate)` inside a location-scoped
   `try/catch`.
4. If previewing throws, return `preview_failed` for that location and continue
   processing the other locations.
5. Compare `preview.plan.serviceDate` to `expectedServiceDate`.
6. If the dates differ, return `preview_failed` with the expected and received
   dates. Do not call `persistPlan` for that preview.
7. Persist the valid preview inside a second location-scoped `try/catch`.
8. Return `committed` on success or `write_failed` on failure.
9. After all locations settle, query final persisted coverage for the expected
   date and build the overall response.

Checking existing state before previewing is part of the completed fix, not
only an optimization. It lets the second Sunday cron and the watchdog focus on
the failed location without churning valid corrections, mappings, or operator
overrides at the other locations.

## Persisted-state check

The current `countPersistedCampuses()` only proves that a `plans` row exists. It
cannot decide whether a specific location is safe to skip. Add a reusable
campus/date freshness helper rather than treating row existence as completeness.

Suggested shape:

```ts
type CampusDateFreshness =
  | { status: "missing" }
  | { status: "incomplete"; planId: number; reasons: string[] }
  | { status: "complete"; planId: number; pcoPlanId: string };

getCampusDateFreshness(
  campus: PcoCampus,
  serviceDate: string,
): Promise<CampusDateFreshness>
```

The helper should query by the app's campus identity plus `service_date`, not by
a campus-specific branch or assumed PCO plan ID. A location is complete only
when the existing freshness conditions pass:

- the expected number of production slots exists;
- each production slot has LIVE start and end bounds;
- element actuals are present and complete; and
- no open slot-blocking incident remains (`slot_resolution`,
  `missing_live_bounds`, `zero_live_window`, or `reconciliation_gap`).

Refactor the checks currently in `getPlanFreshness(campus, pcoPlanId)` so the
Monday repair and the new campus/date helper share one internal evaluator. Do
not maintain two definitions of “complete.” The Monday public behavior and
response statuses should not otherwise change.

If the persisted state is `incomplete`, re-run that location. The existing
idempotent writer should replace/repair generated data while preserving its
documented correction, mapping, and override behavior.

## Result contract

Keep `expectedServiceDate`, `writesPerformed`, `verification`, and `campuses` in
the recurring response. Normalize each campus to one of these statuses:

| Status | Meaning | Counts as a write this run |
|---|---|---:|
| `committed` | Preview was current and the campus write succeeded | Yes |
| `skipped_complete` | Persisted campus/date data passed freshness checks | No |
| `preview_failed` | PCO fetch, qualification, plan construction, or date validation failed | No |
| `write_failed` | A valid current preview could not be persisted | No |

Every campus result should contain `campus`; include `pcoPlanId` and `planId`
when known. Failure results should include a sanitized `error`. A wrong-date
message must include both dates because it is operationally useful and does not
contain a secret.

Example when MG is locally unqualified and the other locations commit:

```json
{
  "ok": false,
  "expectedServiceDate": "2026-07-12",
  "writesPerformed": 3,
  "verification": {
    "successfulLocations": 3,
    "expectedLocations": 4
  },
  "campuses": [
    { "campus": "SLP", "status": "committed", "pcoPlanId": "..." },
    {
      "campus": "MG",
      "status": "preview_failed",
      "error": "No completed production service was found for 2026-07-12"
    },
    { "campus": "ELK", "status": "committed", "pcoPlanId": "..." },
    { "campus": "LV", "status": "committed", "pcoPlanId": "..." }
  ]
}
```

On the next retry, the three complete locations should report
`skipped_complete`. If MG becomes qualified and commits, final verification is
four of four and the response is `ok: true` with `writesPerformed: 1`.

### Verification semantics

Preserve the existing externally visible coverage fields because Review, the
watchdog, tests, and operations documentation already use them:

```ts
verification: {
  successfulLocations: number;
  expectedLocations: number;
}
```

`successfulLocations` is the number of distinct persisted campus plans for the
exact expected date after all attempted writes. It may include locations written
by a prior attempt. Set overall `ok` from final coverage, not from
`campuses.every(status === "committed")`; `skipped_complete` is a healthy retry
result.

The per-campus freshness result controls whether a campus is skipped. The
coverage count remains the existing scheduler/watchdog signal and should not be
silently redefined in this change.

## Files to change

### `src/lib/pco/recurring-ingestion.ts`

- Remove the early return triggered by any rejected or wrong-date preview.
- Extract a typed `runRecurringCampusIngestion()` helper.
- Add/inject `getCampusDateFreshness` for testability.
- Refactor the existing plan freshness evaluator so Sunday and Monday share the
  completeness rules.
- Run all campus helpers independently.
- Query verification only after all campus operations finish.
- Calculate `writesPerformed` from `committed` results.
- Calculate `ok` from final four-of-four persisted coverage.
- Keep error conversion location-scoped.

### `src/lib/pco/recurring-ingestion.test.ts`

- Replace tests that assert zero writes after one preview failure.
- Add the parameterized isolation and retry matrix below.
- Retain the existing Monday repair coverage and add a shared-freshness test if
  the refactor changes its dependencies.

### `src/app/api/pco/ingest/route.test.ts`

- Assert that a partial result remains HTTP 502.
- Assert that the JSON body still exposes successful writes and the failed
  campus instead of collapsing into a route-level exception.
- Assert that a recovered retry with final four-of-four coverage returns 200.

### `src/lib/pco/ingest-health.ts` and its tests

- No scheduling change is required.
- Preserve the current four-of-four health requirement.
- Add coverage only if a helper refactor touches the query contract.

### `src/app/api/pco/ingest/watchdog/route.ts` and workflow

- No schedule or authorization change is required.
- Confirm by test/review that below-four coverage invokes the same recurring
  function, which now skips complete campuses and retries only incomplete ones.
- Keep `.ok == true` and four-of-four as the watchdog success gate.

### Documentation

After the code ships, update
[`docs/ingest-operations.md`](ingest-operations.md). Replace the statement that
one failed preview causes zero writes with the campus-isolated behavior and add
`skipped_complete` to the recovery interpretation. Update the July 12 incident
document only if it is intentionally being tracked as part of the same work.

No `vercel.json` cron change and no database migration should be necessary. If
the campus/date freshness query cannot be expressed safely with the existing
REST layer, stop and document the required schema/query change before adding a
new migration.

## Required test matrix

Use the real `PCO_CAMPUSES` list and parameterize location failures. Tests must
not prove the fix only for MG.

### Preview isolation

For each of `SLP`, `MG`, `ELK`, and `LV`:

- make that campus's preview throw;
- verify the other three valid campuses call `persistPlan`;
- verify the failing campus never calls `persistPlan`;
- expect `writesPerformed: 3`;
- expect the failed campus to report `preview_failed`; and
- expect `ok: false` when final coverage is three of four.

### Wrong-date isolation

For each campus:

- return a prior-Sunday preview only for that campus;
- verify the stale plan is never written;
- verify all other current-date campuses are written; and
- verify the campus error contains expected and received dates.

### Write isolation

For each campus:

- make only its persistence call reject;
- verify the other three commits remain successful;
- expect `write_failed` only for the selected campus; and
- verify final partial coverage remains `ok: false`.

### Retry behavior

- Three locations complete, one missing: skip the three and preview/write only
  the missing location.
- Three locations complete, one incomplete: skip the three and rebuild only the
  incomplete location.
- Missing location recovers: one write, final four-of-four, `ok: true`.
- Missing location still fails: zero new writes, existing three remain, final
  three-of-four, `ok: false`.
- A complete location freshness check fails: report that location failure and
  continue processing the rest; do not assume it is safe to skip.

### Combined and boundary cases

- Two different locations fail at different stages; every remaining valid
  location still commits.
- All four previews fail; zero writes and four explicit failure results.
- All four locations are already complete; zero writes, four
  `skipped_complete` results, and `ok: true`.
- All four fresh previews and writes succeed; four writes and `ok: true`.
- Four writes fulfill but verification reports only three persisted locations;
  `ok: false`.
- Campus array order does not change result association.
- Existing writer tests continue to prove idempotence and preservation of
  operator-managed data.

## Observability and operations

Keep the route-level request ID and start/completion logs in
`runSecuredPcoIngest()`. Add one structured log per campus operation with at
least:

- `requestId` if it is passed into the ingestion layer, otherwise a shared
  invocation identifier;
- `campus`;
- stage (`freshness`, `preview`, `date_validation`, `write`);
- result status;
- `expectedServiceDate`;
- `pcoPlanId` when known; and
- duration.

Do not log credentials, authorization headers, raw PCO responses, or Supabase
secrets.

The final summary log should make partial success obvious: counts for committed,
skipped complete, preview failed, write failed, and final persisted coverage.
HTTP 502 for a three-of-four run is intentional even though three writes were
successful; it is the signal that keeps automatic recovery and the GitHub issue
open.

## Rollout sequence

1. Implement the shared freshness evaluator and tests.
2. Implement the isolated per-campus Sunday helper.
3. Replace the global preview gate and add the full test matrix.
4. Update route tests and operations documentation.
5. Run `npm run typecheck`, `npm test`, and `npm run lint`.
6. Confirm `vercel.json` still contains the Sunday primary, Sunday retry, and
   Monday repair schedules without modification.
7. Confirm the GitHub watchdog still requires `ok: true` and four-of-four.
8. Deploy through the normal production path.
9. After deployment, perform a read-only health check. Only trigger a manual
   production ingest with explicit operator approval.
10. During the next Sunday window, verify that any local failure leaves valid
    campuses persisted and that the retry targets only missing/incomplete data.

Do not deliberately corrupt or suppress a production campus to test isolation.
The parameterized test matrix is the failure-injection proof; production
verification should be observational.

## Acceptance criteria

- [ ] A preview failure at any one location does not stop the other three from
      being written.
- [ ] A wrong-date preview at any one location is rejected without blocking the
      other three.
- [ ] A database failure at any one location does not undo or prevent the other
      location writes.
- [ ] The primary cron, Sunday retry, watchdog recovery, and manual route all use
      the isolated implementation.
- [ ] Complete campuses are skipped on retry; missing and incomplete campuses
      are retried.
- [ ] Successful campus writes remain committed after a partial run.
- [ ] Partial final coverage returns `ok: false`/HTTP 502 and remains visible to
      the watchdog and operators.
- [ ] Final four-of-four coverage returns `ok: true`, including when only one
      campus was written by the current retry.
- [ ] Exact expected-Sunday validation remains enforced independently for every
      campus.
- [ ] No campus-specific exception or hard-coded failure path is introduced.
- [ ] Monday repair continues to isolate failures and shares the same definition
      of persisted completeness.
- [ ] Typecheck, tests, and lint pass.

## Non-goals

- Changing service-time, bumper, message, or broadcast-window calculations.
- Changing PCO taxonomy or mapping behavior.
- Filling missing timekeeping data with estimates.
- Treating three-of-four as a successful weekly ingest.
- Suppressing the Review health banner or watchdog issue for a partial run.
- Removing the Monday repair job.
- Changing cron times, authentication, or the write-enable control.

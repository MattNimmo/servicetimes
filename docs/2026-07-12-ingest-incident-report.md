# Planning Center ingest incident report — July 12, 2026

## Executive summary

The scheduled Planning Center actuals ingest did not run on Sunday, July 12,
2026. Production runtime logs show that no scheduled request reached
`/api/pco/ingest`, and the production database contains no `ingest_runs` rows
for the expected `2026-07-12` service date.

The available evidence identifies this as a scheduler-side miss rather than an
application, authentication, Planning Center, or database failure. Production
deployments replaced the active cron definitions during both Sunday scheduling
windows. On Vercel Hobby, where cron execution has per-hour precision, those
deployments are the most likely reason the pending invocations were not
dispatched. Vercel does not expose enough scheduler telemetry to prove that
internal sequence conclusively, so deployment interference remains a
high-confidence inference rather than a confirmed platform root cause.

No manual production ingest was triggered during the investigation.

## Impact

- Actual service timing data for July 12 was not ingested automatically.
- No successful location writes were recorded for the expected Sunday.
- Glance remained in its pending freshness state during the configured retry
  window and would transition to action-needed after that window expired.
- The Monday repair job remained available as the final automated backstop, but
  it did not provide same-day freshness.

## Timeline

All local times are Central Daylight Time. UTC is included where it materially
clarifies the cron schedule.

| Time | Event |
|---|---|
| 2:00–2:59 PM (19:00–19:59 UTC) | Vercel Hobby execution window for the primary `0 19 * * 0` job. |
| Approximately 2:42 PM | PR #33 deployed the hardened schedule and replaced the production cron definitions during the primary window. |
| 3:05 PM (20:05 UTC) | Nominal start of the retry job's Hobby execution window. |
| 3:05:05 PM | PR #34 became Ready and Vercel recorded the cron definitions as updated on the new production deployment. |
| 3:42 PM | Initial production recheck found no July 12 ingest rows and no cron request in runtime logs. |
| 3:46–3:51 PM | Expanded investigation confirmed no invocation on the relevant deployments, three active cron definitions, required environment-variable names, and no active Vercel incident. |

## Confirmed evidence

### The route was not invoked

Production runtime logs for the relevant deployments contain normal page
traffic but no scheduled request to `/api/pco/ingest`. Because the route was
never invoked, this incident did not produce an application response such as:

- `401` for a `CRON_SECRET` mismatch;
- `503` for missing configuration or disabled writes;
- `502` for preview or persistence failure; or
- a function timeout or uncaught route exception.

An earlier unauthenticated diagnostic request did reach the route and returned
`401`, confirming that the deployed endpoint was reachable and its basic
authentication guard was active. That diagnostic request was not a cron
invocation and performed no writes.

### The database was not updated

A read-only production query of `ingest_runs` showed no rows for
`window_start = 2026-07-12`. The latest successful rows remained from the prior
week, with the most recent entries recorded on July 6 for the July 5 service
date.

### The cron definitions are registered

Vercel reported these three active production jobs:

| Path | Schedule | Purpose |
|---|---|---|
| `/api/pco/ingest` | `0 19 * * 0` | Sunday primary |
| `/api/pco/ingest` | `5 20 * * 0` | Sunday retry |
| `/api/pco/ingest/backfill` | `0 10 * * 1` | Monday repair |

Vercel's authenticated project metadata associated all three definitions with
the current Ready production deployment. Multiple schedules sharing one route
are supported and are distinguished by the `x-vercel-cron-schedule` request
header, so the shared path is not itself evidence of a configuration error.

### Production configuration exists

Vercel listed the required production environment-variable names, including:

- `CRON_SECRET`;
- `ENABLE_PCO_INGESTION_WRITES`;
- Planning Center credentials; and
- Supabase credentials.

The values were not retrieved or exposed during the investigation. Variable
presence alone does not prove that every value is correct, but a bad value
cannot explain this incident because no scheduled request reached the route.

### No Vercel incident was active

Vercel's status API reported all systems operational, including Cron Jobs,
Functions, Logs, and Deployments. There was no active incident matching the
missed execution window.

## Most likely cause

The strongest explanation is production deployment interference with Vercel
Hobby's imprecise cron dispatch:

1. The primary job was eligible to run at any point from 2:00 through 2:59 PM.
2. The hardened scheduling deployment replaced the cron configuration at
   approximately 2:42 PM, while that primary window was still open.
3. The retry was nominally scheduled for 3:05 PM and could run through 4:04 PM.
4. The next production deployment became Ready at 3:05:05 PM and Vercel's
   project metadata recorded the cron configuration update at essentially the
   same moment.
5. Neither deployment received a cron request, and no database write followed.

Vercel documents that cron definitions are updated by redeploying and that
Hobby cron execution has per-hour precision of plus or minus 59 minutes. The
observed deployment timing therefore creates a credible race in which the
pending schedule was replaced before dispatch.

Vercel does not expose the selected dispatch time, a skipped-run event, or
scheduler decision logs for this project. The investigation can establish that
the request never left the scheduler, but it cannot prove the scheduler's
internal reason for skipping it.

## Immediate recovery

The same-day recovery procedure is:

1. Confirm once more that no successful July 12 rows appeared.
2. Send one authenticated `POST` request to the production ingest endpoint.
3. Capture the returned `X-Ingest-Request-Id` for correlation.
4. Verify four successful location writes for `2026-07-12`.
5. Confirm that all four campuses have persisted plans for the service date.
6. Confirm that the operator Glance freshness banner clears.
7. Review unmapped-item and incident counts before declaring recovery complete.

The ingestion writer is idempotent, so a later retry or Monday repair can
safely revisit already-persisted plans.

## Corrective actions

### Required

- Decouple the recovery scheduler from ordinary Vercel production deployments.
- Use a freshness-aware watchdog that checks whether all four locations are
  present before invoking the idempotent ingest.
- Persist scheduler-attempt evidence separately from ingestion writes so a
  missing invocation can be distinguished from an early route failure without
  relying only on short-lived runtime logs.
- Alert operators when no scheduler attempt is recorded by the freshness
  deadline.

### Recommended implementation

Use a scheduler outside the Vercel deployment lifecycle—such as a
database-backed scheduler or another independently deployed scheduled
workflow—to call the secured endpoint and retry on missing or incomplete data.
Keep the Vercel jobs as a secondary layer if desired, but do not make same-day
freshness depend exclusively on Hobby cron dispatch.

If Vercel remains the primary scheduler, upgrade to a plan with per-minute
precision and establish a deployment freeze around the Sunday execution
window. A deployment freeze reduces this incident's specific risk but is not as
strong as an independently scheduled, freshness-aware watchdog.

## References

- [Vercel Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel Cron Jobs management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Vercel status](https://www.vercel-status.com/)
- [Ingest operations and recovery runbook](./ingest-operations.md)


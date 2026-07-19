# Ingest operations and recovery

This runbook describes the production schedule, evidence, and recovery path for
the Planning Center actuals ingest.

## Scheduling model

The Vercel project currently runs on the Hobby plan. Hobby cron expressions have
per-hour precision, so a job scheduled at `19:00 UTC` may start at any point from
`19:00` through `19:59 UTC`. The schedule is deliberately layered:

| Layer | Schedule | Purpose |
|---|---|---|
| Sunday primary | `0 19 * * 0` | First attempt; 2:00–2:59 PM CDT / 1:00–1:59 PM CST |
| Sunday retry | `5 20 * * 0` | Idempotent second attempt after the primary window; 3:05–4:04 PM CDT / 2:05–3:04 PM CST |
| Monday repair | `0 10 * * 1` | Repair missing or incomplete recent plans; 5:00–5:59 AM CDT / 4:00–4:59 AM CST |
| Independent Sunday watchdog | `10 21 * * 0` | GitHub Actions freshness check after the Vercel retry window; 4:10 PM CDT / 3:10 PM CST |
| Independent Monday watchdog | `10 12 * * 1` | GitHub Actions verification after the Vercel repair window; 7:10 AM CDT / 6:10 AM CST |

Vercel cron schedules are fixed in UTC. Do not describe the primary as an exact
2:00 PM Central trigger. Upgrading the project to Vercel Pro is the path to
per-minute scheduling precision; the application-level retry and health signal
remain useful even on Pro.

The GitHub Actions watchdog is deliberately outside the Vercel deployment
lifecycle. It calls `/api/pco/ingest/watchdog`, skips writes when all four
locations are already current, and invokes the idempotent recurring ingest only
when freshness is incomplete. It retries transient HTTP failures and opens or
updates a GitHub issue if the endpoint does not verify all four locations. The
workflow authenticates without a copied long-lived secret: GitHub issues a
short-lived OIDC token whose audience, repository ID, main-branch ref, workflow
path, signature, and event type are validated by the watchdog route.

## What success looks like

A full weekly run leaves a persisted plan for the expected Sunday at all four
locations and creates one successful `ingest_runs` row per atomic location
write. Each Sunday attempt checks persisted completeness by campus and date
before contacting Planning Center. A retry reports complete locations as
`skipped_complete` and targets only missing or incomplete locations.

Success is based on persisted coverage, not the number of fulfilled RPC calls.
The response must contain:

- `ok: true`;
- the expected Chicago Sunday in `expectedServiceDate`; and
- matching `verification.successfulLocations` and
  `verification.expectedLocations`, both equal to four.

Recurring ingestion validates every campus preview against the expected Sunday
independently. A missing, unqualified, stale, or failed campus is not written,
but it does not prevent other qualified campuses from committing. The response
remains a failure (`ok: false` and HTTP 502) until final persisted verification
reaches four of four, so the Sunday retry and watchdog remain active after a
partial commit.

Campus result statuses have these recovery meanings:

- `committed`: this attempt wrote a current plan for the campus;
- `skipped_complete`: existing campus/date data passed the full completeness
  checks, so the attempt deliberately did not rewrite it;
- `preview_failed`: Planning Center retrieval, qualification, plan construction,
  freshness checking, or exact-date validation failed for this campus; and
- `write_failed`: the campus had a valid current preview, but its atomic write
  failed.

Every route invocation writes a structured runtime-log start line containing:

- `requestId`
- trigger (`vercel-cron`, `manual`, or `direct`)
- the `x-vercel-cron-schedule` value when Vercel supplied it

Completion and failure lines include the same request ID and elapsed duration.
The HTTP response also returns `X-Ingest-Request-Id` and `Cache-Control: no-store`.

Operators see an ingest-health banner on Review when the expected four writes
have not appeared:

- **Pending** through the end of the Sunday retry window.
- **Action needed** after the retry window closes.
- No banner after all four location writes are recorded.

## Investigation commands

```bash
vercel inspect servicetimes.vercel.app
vercel env ls production
vercel logs --environment production --no-branch --since 2h --query '/api/pco/ingest'
gh run list --workflow 'Production ingest watchdog' --limit 10
```

Use the Vercel Cron Jobs settings page to confirm all three schedules are active.
The presence of `CRON_SECRET` and `ENABLE_PCO_INGESTION_WRITES` in `vercel env
ls production` confirms only that the variables exist, not that their values are
correct.

Interpret the evidence in this order:

1. **No route request in Vercel logs:** the scheduler has not invoked the route.
2. **401:** Vercel invoked it, but the bearer token did not match `CRON_SECRET`.
3. **503:** the secret is invalid/missing or database writes are disabled.
4. **502:** the route ran, but final coverage is below four of four; successful
   campus writes remain committed. Use the request ID and per-campus statuses to
   identify the missing, preview-failed, or write-failed location.
5. **200 with verified 4/4 coverage:** the weekly ingest completed.
6. **Four reported writes but verification below 4/4:** treat the run as failed;
   inspect each campus's returned service date and Planning Center LIVE bounds.
7. **`skipped_complete`:** no recovery action is needed for that campus; focus
   on the locations that were retried or failed.

The independent workflow history is the durable scheduler-attempt record for
post-window checks. An open `Production ingest watchdog failed` issue means the
latest independent verification did not recover freshness.

## Manual recovery

Only trigger a manual production pull after confirming the Sunday retry did not
recover the run or when immediate data freshness is required. Never print or
commit the secret.

```bash
curl -X POST https://servicetimes.vercel.app/api/pco/ingest \
  -H "Authorization: Bearer $CRON_SECRET"
```

Afterward, confirm four successful rows for the expected Sunday and that the
operator Review banner clears. A `200` response alone is insufficient; inspect
the `verification` object. If a campus reports no completed production service,
correct or finish its LIVE bounds in Planning Center and run recovery again.
The Monday repair and independent watchdog remain automated backstops for
incomplete upstream data.

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

Vercel cron schedules are fixed in UTC. Do not describe the primary as an exact
2:00 PM Central trigger. Upgrading the project to Vercel Pro is the path to
per-minute scheduling precision; the application-level retry and health signal
remain useful even on Pro.

## What success looks like

A full weekly run leaves a persisted plan for the expected Sunday at all four
locations and creates one successful `ingest_runs` row per atomic location
write. The ingestion writer is idempotent, so the Sunday retry can safely repeat
a successful pull.

Every route invocation writes a structured runtime-log start line containing:

- `requestId`
- trigger (`vercel-cron`, `manual`, or `direct`)
- the `x-vercel-cron-schedule` value when Vercel supplied it

Completion and failure lines include the same request ID and elapsed duration.
The HTTP response also returns `X-Ingest-Request-Id` and `Cache-Control: no-store`.

Operators see an ingest-health banner on Glance when the expected four writes
have not appeared:

- **Pending** through the end of the Sunday retry window.
- **Action needed** after the retry window closes.
- No banner after all four location writes are recorded.

## Investigation commands

```bash
vercel inspect servicetimes.vercel.app
vercel env ls production
vercel logs --environment production --no-branch --since 2h --query '/api/pco/ingest'
```

Use the Vercel Cron Jobs settings page to confirm all three schedules are active.
The presence of `CRON_SECRET` and `ENABLE_PCO_INGESTION_WRITES` in `vercel env
ls production` confirms only that the variables exist, not that their values are
correct.

Interpret the evidence in this order:

1. **No route request in Vercel logs:** the scheduler has not invoked the route.
2. **401:** Vercel invoked it, but the bearer token did not match `CRON_SECRET`.
3. **503:** the secret is invalid/missing or database writes are disabled.
4. **502:** the route ran, but preview or persistence failed; use the request ID
   to correlate the full error.
5. **200 with four writes:** the weekly ingest completed.

## Manual recovery

Only trigger a manual production pull after confirming the Sunday retry did not
recover the run or when immediate data freshness is required. Never print or
commit the secret.

```bash
curl -X POST https://servicetimes.vercel.app/api/pco/ingest \
  -H "Authorization: Bearer $CRON_SECRET"
```

Afterward, confirm four successful rows for the expected Sunday and that the
operator Glance banner clears. The Monday repair remains the final automated
backstop for incomplete upstream Planning Center data.

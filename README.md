# ECC Service Times v2

Plan-versus-actual service timing for Emmanuel Christian Center.

## Stack

- Next.js App Router + TypeScript
- Planning Center Services API (read-only, version `2018-11-01`)
- Supabase/Postgres
- Vercel

## Build status — 2026-06-23

Shipped to `main`:

- `e149bd4` — Next.js/TypeScript scaffold and GET-only PCO client.
- `a883c04` — live four-campus PCO data-shape probe and validation report.
- `79cf60d` — executable Supabase migration, deterministic seeds, RLS lockdown,
  correction overlays, append-only audit history, and pgTAP tests.
- `bd8427a` — merged occurrence guardrails, pure PCO taxonomy normalizer,
  project-scoped read-only Supabase MCP, and GitHub CI.
- `7797ada` — merged four-campus zero-write ingestion preview.
- `27a760b` — merged taxonomy review classification and approved mappings.

- `973e2a9` — merged atomic PCO ingestion: deployable deterministic
  configuration for hosted projects, slot-scoped review evidence and incident
  supersession, the one-call transactional/idempotent `ingest_pco_plan` RPC, and
  a server-only writer guarded by `ENABLE_PCO_INGESTION_WRITES=true`. 23
  application unit tests and 42 database assertions total.

The hosted Supabase project is connected to GitHub, and CI runs a clean reset,
the full pgTAP suite, and `supabase db lint` against a real Postgres on every
pull request. On 2026-06-24 all four migrations were applied to the hosted
project (`vtleuqtipsxbsdaodcqo`) via `supabase db push`; remote migration
history matches local. The schema, RLS lockdown, occurrence guards, seeded
configuration, and the `ingest_pco_plan` RPC are live. No production timing
data has been ingested yet.

The atomic writer has no caller, so the next slice builds a server-side
`scripts/ingest-weekend.ts` (dry-run by default, `--commit` to write, `--verify`
to reconcile) — fully specified in
[`docs/ingestion-write-path.md`](docs/ingestion-write-path.md). The slice is:

1. build the single-campus ingestion script with dry-run, commit, and verify
   modes, plus an orchestration unit test;
2. dry-run, then load **SLP** with `ENABLE_PCO_INGESTION_WRITES=true` for the
   single controlled call (the 9am slot is the first reconciliation focus; the
   11am PlanTime lands in the same atomic plan);
3. return the write flag to false, reconcile via the service-role read, then
   repeat for ELK / MG / LV.

A recurring authed POST route plus Vercel Cron is a deferred follow-up (auth
mechanism to be settled then); see the spec's "Deferred" section.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Fill `PCO_CLIENT_ID` and `PCO_CLIENT_SECRET` in `.env.local` from the dedicated
`communications@emmanuelcc.org` Viewer token. Never paste those values into
source files, chat, client-side code, or variables prefixed with `NEXT_PUBLIC_`.

Open `http://localhost:3000/api/pco/smoke` in development to verify visible
service types and their reported permissions. The smoke endpoint returns 404 in
production.

Open `http://localhost:3000/api/pco/probe` to inspect the latest completed plan
for the four allowlisted campuses. The development-only, GET-only probe checks
service targets and live durations, plan-time labels, item/header shapes,
possible bundle overlap, zero-allotment timers, and possible timer bleed. It
does not write to Planning Center or a database.

Open `http://localhost:3000/api/pco/ingestion-preview` to build the exact
read-only ingestion plan for the latest completed plan at each campus. The
preview resolves configured production slots, normalizes taxonomy, fingerprints
raw ItemTimes, and emits review incidents and row-shaped output. It performs
zero database writes and returns 404 in production.

The first live result and its backend consequences are recorded in
[`docs/pco-data-shape-validation-2026-06-23.md`](docs/pco-data-shape-validation-2026-06-23.md).

## Commands

```bash
npm run dev
npm run lint
npm run build
npm test
npm run db:start
npm run db:reset
npm run db:test
npm run db:lint
```

## Database

The versioned schema lives in `supabase/migrations`; deterministic campus,
service-slot, section, element, and alias configuration lives in
`supabase/seed.sql` and is mirrored by a deployable configuration migration.
Raw Planning Center values are never replaced by Admin changes. Slot decisions,
bucket changes, and timing corrections are stored as occurrence-level overlays
with revision and audit history.

Local database commands require a Docker-compatible runtime. Link the existing
hosted project with `npx supabase link --project-ref <ref>`, inspect the pending
work with `npx supabase db push --dry-run`, and deploy only the reviewed
migration with `npx supabase db push`.

## Security boundary

`src/lib/pco/client.ts` is server-only and exposes GET requests only. Planning
Center credentials never cross the server boundary. The dedicated PCO user owns
the external read-only permission boundary; the code reinforces it by providing
no write transport.

`src/lib/pco/ingestion-writer.ts` is the separate database write boundary. It
uses only the server-side Supabase service-role key, refuses unvalidated input,
and remains disabled unless `ENABLE_PCO_INGESTION_WRITES` is exactly `true`.

Planning Center requires HTTP Basic Auth for Personal Access Tokens, a User-Agent
header, and supports pinning `X-PCO-API-Version` per request.

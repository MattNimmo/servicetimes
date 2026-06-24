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

The hosted Supabase project is connected to GitHub. It is not yet linked to the
local Supabase CLI or Codex MCP, and the migration has not been confirmed as
applied remotely. No production data has been ingested. The next slice is:

1. strengthen database invariants and run a clean local reset, pgTAP suite,
   database lint, application lint, and production build;
2. connect Codex MCP read-only, link the Supabase CLI, and verify the hosted
   project's PostgreSQL version, migration history, existing objects, and
   recovery posture;
3. dry-run and apply the reviewed migration to the hosted project;
4. build the pure normalizer with golden taxonomy fixtures;
5. build atomic, idempotent PCO ingestion with a dry-run mode;
6. load one representative weekend and reconcile every expected slot and item.

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

The first live result and its backend consequences are recorded in
[`docs/pco-data-shape-validation-2026-06-23.md`](docs/pco-data-shape-validation-2026-06-23.md).

## Commands

```bash
npm run dev
npm run lint
npm run build
npm run db:start
npm run db:reset
npm run db:test
npm run db:lint
```

## Database

The versioned schema lives in `supabase/migrations`; deterministic campus,
service-slot, section, element, and alias configuration lives in
`supabase/seed.sql`. Raw Planning Center values are never replaced by Admin
changes. Slot decisions, bucket changes, and timing corrections are stored as
occurrence-level overlays with revision and audit history.

Local database commands require a Docker-compatible runtime. Link the existing
hosted project with `npx supabase link --project-ref <ref>`, inspect the pending
work with `npx supabase db push --dry-run`, and deploy only the reviewed
migration with `npx supabase db push`.

## Security boundary

`src/lib/pco/client.ts` is server-only and exposes GET requests only. Planning
Center credentials never cross the server boundary. The dedicated PCO user owns
the external read-only permission boundary; the code reinforces it by providing
no write transport.

Planning Center requires HTTP Basic Auth for Personal Access Tokens, a User-Agent
header, and supports pinning `X-PCO-API-Version` per request.

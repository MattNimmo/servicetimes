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

In review on `codex/pco-ingestion`:

- shared read-only latest-plan fetch for the probe and ingestion preview;
- deterministic production-slot selection and row-shaped ingestion batches;
- source fingerprints, review incidents, reconciliation evidence, and 18 unit
  tests total;
- development-only four-campus preview with an explicit zero-write guarantee.
- classified taxonomy review candidates with no silent bucket assignment; see
  [`docs/pco-taxonomy-review-2026-06-23.md`](docs/pco-taxonomy-review-2026-06-23.md).

The hosted Supabase project is connected to GitHub. Codex MCP is authenticated,
project-scoped, and read-only. Live validation on 2026-06-23 confirmed
PostgreSQL 17.6, no `public` tables, no migration history, empty generated
application types, and no security or performance advisor findings. The
Supabase CLI is authenticated, but its token is rejected by the project-status
endpoint during `supabase link` even though the dashboard identity is the
project Owner. No migration or production data has been applied remotely. The
next slice is:

1. run a clean local reset, pgTAP suite, and database lint with a compatible
   container runtime;
2. resolve the Supabase CLI token/link mismatch and verify the hosted project's
   recovery posture;
3. dry-run and apply the reviewed migration to the hosted project;
4. review the live preview's unmapped taxonomy candidates and approve intended
   aliases or rollup relationships;
5. add the atomic database writer behind the validated dry-run planner;
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

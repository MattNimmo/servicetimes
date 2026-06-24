# Build plan — product layer (post-ingestion)

Status: **approved** (2026-06-24). First slice (Phase 1) ready for implementation.

## Context

The PCO ingestion pipeline is complete and live on the hosted Supabase project:
schema + RLS + seeds deployed, all four campuses loaded and reconciled for the
2026-06-21 service date, a controlled write script, and a recurring cron route.
The data the product exists to expose — plan-vs-actual service timing — is now
flowing into `plans`, `plan_times`, `items`, `item_times`, and `review_incidents`.

But **everything above the data layer is unbuilt**: there is no auth, no read
path, no UI beyond a scaffold homepage, and every table is locked to
`service_role` (RLS on, anon/authenticated revoked). Six tables
(`correction_sets`, `correction_values`, `plan_time_slot_resolutions`,
`item_bucket_overrides`, `plan_changes`, `admin_audit_log`) have no writer yet.
Open `review_incidents` only ever auto-close via ingestion's `superseded` path —
nothing resolves them to kept/corrected/excluded.

This plan refines the build roadmap for the product layer and fully specifies the
**first slice**: a viewer-facing plan-vs-actual variance dashboard behind a
minimal two-role auth gate. It targets the end goal (make timing visible) on the
shortest path, while establishing the auth foundation every later slice needs.

Guiding principle for all slices: **less code that achieves the same result is
better; reuse what exists; do not fabricate precision the data doesn't have.**

## Roadmap

- **Phase 0 — ingestion cleanup** (small, do first): apply the review trims
  (extract the shared Supabase REST helper — see Phase 1; collapse the duplicated
  per-campus fetch+build into one `buildCampusPlan(campus)`; drop the redundant
  verifier "open incident count" check); fix the five current test-file type
  errors; add a `typecheck` (`tsc --noEmit`) step to CI so test types cannot rot.
- **Phase 1 — auth gate + viewer variance dashboard** (this slice; specified below).
- **Phase 2 — operator admin panel: review & correction workflow.** Resolve
  `review_incidents` (kept/corrected/excluded), write `correction_sets` /
  `correction_values`, `plan_time_slot_resolutions`, `item_bucket_overrides`,
  with `admin_audit_log` coverage. Operator-only. Consumes `unmapped_items`.
- **Phase 3 — references, recommendations, and levers.** First deploy explicitly
  approved per-campus `reference_target_seconds`, then populate `plan_changes`
  (recommendation vs manual, approve/apply) from reference variance, scoped to
  `is_lever_eligible` elements.
- **Cross-cutting — taxonomy grooming.** Resolve the intentionally-unmapped
  combined-title items and song rollup candidates (per
  `docs/pco-taxonomy-review-2026-06-23.md`) via the Phase 2 tools.

> Reference values are deliberately excluded from Phase 1. Every campus still
> has the unapproved default `reference_target_seconds = 4500`; the viewer must
> not display that value or any derived reference delta. Phase 3 begins with a
> reviewed config migration after the four campus targets are supplied.

---

## Phase 1 slice — auth gate + viewer variance dashboard

### Decision 1: app-level shared-login auth, NOT Supabase Auth

Roles are the principal here (shared logins, not per-user identity), so GoTrue's
per-user accounts + authenticated-RLS rewrite buys nothing and costs a lot. Use a
signed, httpOnly session cookie carrying only the role. Reads stay server-side
via the existing service-role key; RLS keeps its `service_role` lockdown as
defense in depth (unchanged). Zero new dependencies — reuse `node:crypto`
`timingSafeEqual`, already used in `src/app/api/pco/ingest/route.ts`.

Two roles:
- `viewer` — read-only dashboards; must never reach operator routes.
- `operator` — 2-3 people sharing one login; gets the Phase 2 admin panel.

**Session token**: `v1.<base64url(payload)>.<base64url(hmac)>`, payload
`{ role, exp }`, signed `HMAC-SHA256(AUTH_SESSION_SECRET)`. Verify by recomputing
the HMAC and comparing with `timingSafeEqual` (length-guarded), then check `exp`
and known `role`. Cookie `st_session`: `httpOnly`, `secure`, `sameSite=lax`,
`path=/`, 7-day expiry mirrored from `exp`. Tampering (flipping role or exp)
fails HMAC verification.

**Enforcement** (defense in depth — the proxy doc warns proxy must not be the
only gate):
- `src/proxy.ts` (Next 16 renamed `middleware.ts` -> `proxy.ts`; runs on Node
  runtime, so `node:crypto` works): coarse gate. No/invalid session on a
  protected path -> redirect `/login`; `viewer` on an operator path -> redirect
  `/`. Matcher excludes `_next/*`, `favicon.ico`, `/login`, and only the existing
  PCO endpoints with their own route-level protection: `/api/pco/ingest`
  (`CRON_SECRET`) plus `smoke`, `probe`, and `ingestion-preview` (production
  404). Do not broadly exempt future `/api/pco/*` routes.
- `requireRole("operator")` called inside every operator route/server action —
  the real enforcement, since server actions are directly POST-able past the
  proxy matcher.

**Login/logout**: `/login` server component with a `<form action={loginAction}>`;
`loginAction` length-guards and constant-time-compares the submitted password
against `OPERATOR_PASSWORD` then `VIEWER_PASSWORD`, sets the cookie, redirects
`/`. Wrong password redirects to `/login?error=invalid` so the server-only page
can show one generic message without a client component. `logoutAction` clears
the cookie. Config guard: `AUTH_SESSION_SECRET` must be at least 32 characters;
both passwords must be at least 16 characters and must differ. Missing, short,
or equal configuration returns a 503-style "auth not configured" result.

**Launch control**: shared passwords require request throttling. Before the
production login is exposed, configure a Vercel Firewall rate-limit rule for
`/login` (including its Server Action POSTs), and verify it with repeated failed
requests. This is a deployment gate; an in-memory application counter is not
reliable across serverless instances.

### Decision 2: variance math — one new SQL view + app-side slot math

- **Slot grain**: already one row per `effective_plan_times`; the app computes
  `actual_service_seconds` vs `planned_target_seconds` in TypeScript. No view
  (it'd duplicate subtraction). Reference comparisons remain absent until Phase
  3 installs approved targets.
- **Element grain**: needs grouped aggregation with correctness-critical filters,
  so push it into ONE view rather than pulling every item row to JS.

**New view `element_variance`** (`with (security_invoker = true)`, revoke
anon/authenticated, grant select to service_role — matching the two existing
views). Build from each eligible `effective_plan_times` row joined to its plan's
eligible items, then **left join** the matching `item_times` row on both
`item_id` and `plan_time_id`. This preserves planned rows when PCO omits an
ItemTime. One row per plan / effective_slot / effective_element_key, summing
`items.planned_seconds` once per slot and `item_times.actual_seconds`. Resolve
`effective_element_key = coalesce(active item_bucket_overrides.element_key,
items.element_key)` so Phase 2 overrides automatically appear. Filters:
`items.is_rollup_child = false` (no double-count), effective element is not null,
`coalesce(item_times.pco_exclude, false) = false`,
`sections.is_analytics_eligible = true`, `elements.is_tracked = true`,
`items.seen_in_last_pull = true`, and `effective_plan_times` requiring
`is_manually_excluded = false`, `effective_slot_id is not null`,
`time_type = 'service'`. Group by `effective_slot_id` (respects manual slot
remaps). Include `actual_is_complete = bool_and(item_times.id is not null and
item_times.actual_seconds is not null)`. Reads raw actuals; a correction-aware
`coalesce` is a deliberate later boundary.

### Decision 3: never fabricate precision

Three states, reused at both grains: `complete`, `needs_review`, `no_plan`. A
`needs_review` cell renders a pill, not a number, even if raw evidence exists.

Incident gating is grain-aware; the banner still counts **all** open incidents:

- **Slot blockers**: `missing_live_bounds`, `zero_live_window`, and
  `reconciliation_gap` on that production PlanTime, plus a `slot_resolution`
  incident explicitly scoped to that production PlanTime or slot. A run-through
  `slot_resolution` incident with no production slot does not block a production
  cell. A slot blocker cascades to every element cell in that slot.
- **Element blockers**: otherwise non-slot-blocking incidents affect only the
  elements reached through `review_incident_items` for that incident.
  `bundle_overlap` therefore marks the involved elements, not the whole ELK/LV
  service. `missing_item_end` marks its affected element.
- A null/incomplete aggregate (`actual_service_seconds` at slot grain or
  `actual_is_complete=false` at element grain) is also `needs_review`, even with
  no incident.

Read open `review_incidents` once for the plan plus their
`review_incident_items(item_id)` relationships, and match both incident scopes
(`plan_time_id` and `plan_id` + `slot_id`) in app code.

### Viewer dashboard — minimum pages

Server components only (service-role reads server-side), dark Tailwind v4 reusing
the `bg-zinc-950 / border-zinc-800 / font-mono uppercase` idiom in
`src/app/page.tsx`. No component library, no client components.

- `/variance` — campus index (code and name).
- `/variance/[campus]` — service-date list, each with #slots / open-incident /
  unmapped roll-up.
- `/variance/[campus]/[serviceDate]` — the dashboard: header with two
  data-quality banners (open-incident union count; `unmapped_items` count
  filtered by campus+date), per-slot planned/actual + delta/% or
  needs-review pill, and a per-element table from `element_variance` ordered by
  section then element sort.

### Files

New:
- `supabase/migrations/20260624030000_variance_views.sql` — `element_variance` view.
- `src/lib/supabase/rest.ts` — extract `requireEnv` + `readRows<T>(table, params)`
  out of `ingestion-verifier.ts` into one `server-only` helper; verifier and
  `ingestion-writer.ts` import from here (kills the duplication flagged in review).
- `src/lib/variance/queries.ts` — `server-only` typed reads
  (`listCampuses`/`listServiceDates`/`getSlotVariance`/`getElementVariance`/
  `getDataQuality`) + pure `computeVariance()` (delta/% + status). Only place
  variance math lives.
- `src/lib/auth/session.ts` — dependency-free sign/verify (no `next/headers`, so
  `proxy.ts` can import it), cookie constants.
- `src/lib/auth/server.ts` — `server-only`; `getSession()` (async `cookies()`),
  `requireRole()`, `loginAction`, `logoutAction`.
- `src/app/login/page.tsx` — login form.
- `src/proxy.ts` — coarse auth gate + `config.matcher`.
- `src/app/(viewer)/variance/page.tsx`, `.../[campus]/page.tsx`,
  `.../[campus]/[serviceDate]/page.tsx` — the three pages.

Edit:
- `src/app/page.tsx` — gate via `getSession()`; redirect to `/login` if absent;
  link to `/variance`.
- `src/lib/pco/ingestion-verifier.ts` — import the shared `rest.ts` helpers.
- `.env.example` — add `AUTH_SESSION_SECRET`, `VIEWER_PASSWORD`,
  `OPERATOR_PASSWORD` (server-only, never `NEXT_PUBLIC_`).
- `.github/workflows/ci.yml` and `package.json` — add `npm run typecheck` using
  `tsc --noEmit` after repairing the five current test-file errors.

### Reused utilities / building blocks
- `timingSafeEqual` pattern — `src/app/api/pco/ingest/route.ts`.
- `readRows`/`requireEnv` + `server-only` convention — `src/lib/pco/ingestion-verifier.ts`, `ingestion-writer.ts`.
- Views `effective_plan_times`, `unmapped_items`; generated columns
  `planned_target_seconds`/`actual_service_seconds`/`actual_seconds`;
  `sections.is_analytics_eligible`,
  `elements.is_tracked`/`is_lever_eligible` — all in `supabase/migrations/`.
- Dark Tailwind idiom — `src/app/page.tsx`.

### Next.js 16 gotchas (verified in `node_modules/next/dist/docs/`)
- `middleware.ts` -> **`proxy.ts`** (function `proxy`); Node runtime.
- `cookies()` is **async** (`await cookies()`); `.set`/`.delete` only in server
  actions/route handlers, never during render — so login/logout are actions and
  the homepage gate only reads.
- `params`/`searchParams` are **Promises** — `await params` in async pages.
- `fetch` is uncached by default; the REST helper's `cache:"no-store"` keeps reads
  live. **Do not** add `unstable_instant` (needs `cacheComponents`, not enabled).
- Re-read the docs folder before changing any data-fetching/cookies/proxy API.

### Verification
1. **Auth unit test** (mirror `route.test.ts`): valid viewer/operator tokens
   verify; tampered role, expired `exp`, and garbage cookie all return null.
2. **Auth manual**: login both roles -> cookie set, `/variance` renders; wrong
   password -> generic error, no cookie; viewer hitting an operator route ->
   redirected AND a direct POST to an operator action -> rejected by
   `requireRole`; no cookie -> `/` redirects to `/login`.
3. **Variance vs loaded 2026-06-21 data** (read-only REST queries + eyeball):
   - Slot deltas equal `actual_service_seconds - planned_target_seconds` for
     non-excluded service slots (SLP/ELK/LV). No unapproved reference value or
     reference delta renders.
   - Element grain excludes `is_rollup_child` rows and `is_analytics_eligible=false`
     sections (e.g. `pre.countdown` never appears); summed actual matches a raw
     `sum(item_times.actual_seconds)` minus excluded/rollup.
   - **MG**: null/incomplete live bounds and slot-blocking incidents render
     "needs review", never 0 or a fake delta; banner counts equal DB
     `status=eq.open` union and `unmapped_items` counts.
   - **ELK/LV**: `bundle_overlap` marks only affected element rows; it does not
     suppress otherwise-complete slot headline actuals or unrelated elements.
   - Idempotency: re-loaded plans show once; superseded incidents excluded.
4. `npm run dev` -> load `/variance/MG/2026-06-21` to confirm pills/banners match
   the queries. Run `npm test`, `npm run lint`, `tsc --noEmit`, and (with Docker
   in CI) `npm run db:test` / `db:lint` for the new view.

### Out of scope for this slice
Corrections/incident resolution writes (Phase 2), approved campus reference
targets and recommendations (Phase 3), and any client-side Supabase SDK.

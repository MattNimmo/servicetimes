# Build plan — product layer (post-ingestion)

Status: **Phases 0–2B fully implemented** (as of 2026-06-28). Phase 2B shipped
in five slices: slot-actual corrections (`05c1ae9`), slot-resolution workflow
(`d785bd8`), item-time actual corrections (`7ab229d`), non-production exclusion
rules (`f62fcfc`), and the PCO-familiar service-flow operator workspace
(`15496a2`). **Phase 3 is started**: reference-target approval guardrails shipped
(`bb6bbc5`) and the planned-item recommendation generator shipped (`46e7fe0`,
superseding the reference-target generator in `c407977`). The next Phase 3 slice
is surfacing/applying generated recommendation `plan_changes`. Production auth
secrets and the login rate-limit gate remain operational steps.

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

- **Phase 0 — ingestion cleanup** (**implemented**): apply the review trims
  (extract the shared Supabase REST helper — see Phase 1; collapse the duplicated
  per-campus fetch+build into one `buildCampusPlan(campus)`; drop the redundant
  verifier "open incident count" check); fix the five current test-file type
  errors; add a `typecheck` (`tsc --noEmit`) step to CI so test types cannot rot.
- **Phase 1 — auth gate + viewer variance dashboard** (**implemented**; specified below).
- **Phase 2A — operator review queue** (**implemented**): list open
  `review_incidents` behind the operator gate and resolve incidents as
  `kept`/`excluded` through one audited database RPC.
- **Phase 2B — operator admin panel: correction workflow** (**implemented**). Resolve
  `review_incidents` (kept/corrected/excluded), write `correction_sets` /
  `correction_values`, `plan_time_slot_resolutions`, `item_bucket_overrides`,
  with `admin_audit_log` coverage. Operator-only. Consumes `unmapped_items`.
- **Phase 3 — references, recommendations, and levers** (**started**). Reference
  target approval metadata + audited approval helper shipped in `bb6bbc5`.
  Planned-item `plan_changes` generation shipped in `46e7fe0` after clarifying
  that targets are the planned item times for each service/location, not
  approved campus-wide reference durations. Next: surface/apply generated
  recommendations.
- **Cross-cutting — taxonomy grooming.** Resolve the intentionally-unmapped
  combined-title items and song rollup candidates (per
  `docs/pco-taxonomy-review-2026-06-23.md`) via the Phase 2 tools.

> Reference values are deliberately excluded from Phase 1. Every campus starts
> with the unapproved default `reference_target_seconds = 4500`; the viewer must
> not display that value or any derived reference delta. Phase 3 now has an
> explicit `reference_target_status` guard, audited
> `approve_campus_reference_target(...)` helper, and
> `generate_planned_item_plan_changes(...)` helper. Recommendation targets are
> the planned item durations for that service/location; campus reference targets
> are separate display/operating context and do not gate recommendations.

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

### Phase 2A slice — operator review queue + resolution

This slice creates the first operator-only write path without changing timing
math yet:

- `/operator/review` lists every open `review_incidents` row with campus, service
  date, slot/PlanTime context, affected item titles, and a dashboard deep link.
- `resolveReviewIncidentAction` calls `requireRole("operator")` before writing;
  viewer sessions and direct action POSTs are rejected by the server-side gate.
- `public.resolve_review_incident(...)` is the only write primitive. It locks the
  incident, allows only `kept` or `excluded`, updates `resolved_at` /
  `resolved_by`, and inserts one `admin_audit_log` record in the same
  transaction.
- This intentionally does **not** create corrections, item bucket overrides, or
  slot remaps. Those remain Phase 2B because they need correction-specific forms
  and validation rules.

### Out of scope for Phase 1
Corrections/incident resolution writes (Phase 2), approved campus reference
targets and recommendations (Phase 3), and any client-side Supabase SDK.

### Phase 2B slice 1 — slot actual corrections — ✅ shipped (`05c1ae9`)

This first Phase 2B increment keeps the correction surface narrow:

- Operators can correct the actual duration for a PlanTime-scoped incident from
  `/operator/review`.
- The write path creates one `correction_set`, inserts one `correction_values`
  row targeting that incident's `plan_time_id`, marks the incident `corrected`,
  and writes one `admin_audit_log` record atomically.
- Viewer slot variance reads the active corrected actual in preference to the
  raw `plan_times.actual_service_seconds`, so corrected headline values appear
  without mutating PCO evidence.
- Item-time corrections, slot remaps, and item bucket overrides remain later
  slices because they need separate validation and UI.

### Phase 2B slice 2 — slot-resolution workflow — ✅ shipped (`d785bd8`)

This slice turns `slot_resolution` review cards into actual occurrence-level
decisions instead of queue triage:

- Operators can map a PlanTime to one of the configured active campus slots.
- Operators can exclude a PlanTime from variance entirely when it represents a
  run-through or other non-production service.
- The write path creates a new `plan_time_slot_resolutions` revision, supersedes
  any prior active resolution, marks the incident `corrected`, and writes one
  `admin_audit_log` record atomically.
- The viewer dashboards pick up the change automatically through
  `effective_plan_times`, so remapped or excluded slots change the live
  variance surface without mutating raw PCO evidence.

### Phase 2B slice 3 — item-time actual corrections — ✅ shipped (`7ab229d`)

This slice resolves element-level timing incidents that need corrected item
durations rather than slot decisions:

- Operators can save one or more corrected item actuals on a single review card.
- The write path creates one `correction_set`, inserts one `correction_values`
  row per corrected `item_time_id`, marks the incident `corrected`, and writes
  one `admin_audit_log` record atomically.
- `element_variance` reads active corrected item-time actuals in preference to
  raw `item_times.actual_seconds`, so affected element rows update immediately
  on the dashboard without mutating raw PCO evidence.
- Planned item corrections and item bucket overrides remain later slices.

### Phase 2B slice 4 — non-production exclusion rules — ✅ shipped (`f62fcfc`)

This slice turns repeated operator judgment into ingestion/runtime policy:

- Rehearsal PlanTimes should never be treated as production variance slots.
- Review cards should not force operators to decide whether a rehearsal belongs
  to 9am or 11am; the system should auto-exclude those occurrences from
  variance by rule.
- Start with a narrow, explicit rule for `Rehearsal`, then extend to other
  known non-production names only after review.
- The current operational workaround is manual exclusion in the operator queue;
  for example, the MG `Rehearsal` PlanTime on Sunday, June 21, 2026 was
  manually excluded and should become the baseline product behavior.

### Phase 2B slice 5 — service-flow operator workspace — ✅ shipped (`15496a2`)

The current review queue proves the write paths, but the long-term admin
experience should feel closer to PCO's plan view: operators open a service date,
see the service times in context, and resolve highlighted issues inside the flow
of the service instead of scanning detached incident cards.

- The main operator view should be organized by campus, service date, and
  service time/PlanTime, with a left rail or compact list for the day's
  occurrences.
- The center workspace should show the selected service time's order of items
  in sequence, grouped by section where possible.
- Items, PlanTimes, or elements that need review should be highlighted inline
  where they occur in the service flow.
- Classification/correction controls should appear beside the affected
  PlanTime or item, with raw IDs, links, and JSON attributes hidden behind a
  details disclosure for troubleshooting.
- The operator should be able to resolve slot mapping, slot actuals, item
  actuals, kept/excluded decisions, and future bucket classification from the
  same service-context workspace.
- The existing `/operator/review` queue can remain as a filtered backlog, but
  it should link into this service-flow view rather than being the primary
  working surface.

### Phase 3 slice 1 — reference-target approval guardrails — ✅ shipped (`bb6bbc5`)

This slice prevents the default 4500-second target from being mistaken for an
approved operating reference:

- Add `campuses.reference_target_status`,
  `reference_target_approved_by`, and `reference_target_approved_at`.
- Add `approve_campus_reference_target(campus_code, seconds, approved_by)` so
  future target changes happen through one audited database entry point.
- Keep existing Instrument target labels provisional until a campus target is
  approved, then switch copy to "reference target."
- Add pgTAP coverage for provisional defaults, approval consistency, bad input,
  approved target writes, and audit-log writes.

### Phase 3 slice 2 — planned-item plan-change generator — ✅ shipped (`46e7fe0`)

This slice creates the recommendation write path using the service plan itself as
the target source:

- Add `generate_planned_item_plan_changes(campus_code, service_date, actor,
  min_element_delta_seconds)` as the single database entry point for generating
  recommendation `plan_changes`.
- Drop the earlier reference-target generator from `c407977`; it had the wrong
  target model.
- Generate recommendations only from complete, over-plan,
  `is_lever_eligible` element variance where actual element duration exceeds
  the planned element duration for that same service/location.
- Store planned-item target evidence on each recommendation.
- Avoid duplicating an already-open campus/slot/element recommendation.
- Add pgTAP coverage that recommendations do not require approved campus
  reference targets, plus lever eligibility, evidence payloads, and duplicate
  suppression.

Next Phase 3 slice: expose generated `plan_changes` in an operator-facing
review/apply surface.

### Deployment gates

1. Merge only after application CI and the clean Supabase reset/pgTAP/lint job
   pass, then deploy `20260624030000_variance_views.sql` through the linked CLI.
2. Configure production `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SESSION_SECRET`, `VIEWER_PASSWORD`, and
   `OPERATOR_PASSWORD`; keep every secret except the project URL server-only.
3. Configure and verify the Vercel Firewall rate-limit rule for `/login` before
   distributing either shared password.
4. Exercise viewer and operator login, then validate SLP, ELK, LV, and MG against
   the loaded 2026-06-21 data. MG must show review pills; ELK/LV bundle overlap
   must affect only involved element rows.

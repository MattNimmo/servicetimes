# Harden pass — task handoff

Self-contained work order for an agent (Codex) to execute. You do **not** have
the originating conversation; everything you need is here. Read the whole file
before editing.

## What this app is

ECC Service Times: plan-versus-actual weekend service timing for Emmanuel
Christian Center's four campuses. Next.js App Router + TypeScript + Tailwind v4,
Supabase behind a server-only REST layer. Primary audience is **campus pastors
and leadership** (role `viewer`); a smaller **operator** role does data triage.
See `PRODUCT.md` for the full brief.

This work order is one pass ("harden") in a larger design-review effort. Four
passes already shipped (layout, clarify, colorize, typeset). Your job is the
harden pass only.

## Guardrails — respect these; they are already established across the app

- **"vs plan" is the one public number.** Leadership surfaces compare actual to
  planned, never to a "target." Targets are an operator-only calibration concept
  and appear only inside Workbench. Don't reintroduce target language on viewer
  surfaces.
- **Sentence case, not tracked caps.** The app was just de-uppercased. New copy
  is sentence case. The only deliberate all-caps elements are the single
  page-level `.instrument-eyebrow` kicker and the brand wordmark. Don't add
  `textTransform: uppercase` or wide `letter-spacing` to new text.
- **ECC vocabulary.** Campuses are Spring Lake Park (SLP), Elk River (ELK),
  Lakeville (LV), Maple Grove (MG). "Tech Team" verifies numbers; items go
  through "Triage"; unmatched (not "unmapped") items need matching. Keep it
  plain — a pastor should understand every word.
- **Role-gate operator plumbing.** Incident/unmatched counts, Triage links, and
  correction machinery are operator-only. Viewers see verdicts, not plumbing.
- **Liquid glass is the identity — keep it.** Reuse existing tokens
  (`--glass-filter`, `--glass-shadow`, `--glass-border`, `.glass-card`,
  `.glass-tile`) and text-safe status colors (`--over`, `--under`, `--review`,
  `--accent-text`, `--phase-mid-text`). Don't invent new colors.
- **Verify, don't assume.** `npm run typecheck` and `npm test` must stay green.
  There are 63 tests; keep them passing.

## Out of scope — do NOT do these (a later "polish" pass owns them)

- Sticky-nav scrolled-state opacity / two-row wrap fix
- Text-safe variants for campus dot colors on active switches
- Clipped-dropdown `overflow` fix on the Workbench glass-card
- Trend-chart median-label collision and broadcast-chart dead space
- Radii-drift cleanup (10/12/14/16/18 → tokens)

Leave all of the above alone. If you notice them, note them but don't touch them.

---

## Task 1 — Stop steering to dead-end (non-production) dates

**Problem.** Some plans have flagged items but **no production service slots**
(rehearsals, special events). On those dates Triage has nothing to render in
service order, yet their flagged items still inflate the per-date attention
counts and the "Worst outstanding" jump — so leadership/operators get steered to
a date where nothing can be acted on. Confirmed live on SLP · 2026-05-31.

**Where.**

- `src/lib/instrument/queries.ts` → `ServiceDateOption` type (~line 659) and
  `listInstrumentServiceDates` (~line 665). Today it maps
  `attentionCount: d.openIncidentCount + d.unmappedCount`. The source rows `d`
  come from `listServiceDates` (in `src/lib/variance/queries.ts`) and already
  include `slotCount` (count of production service slots for that plan).
- `src/components/instrument/TriageView.tsx` → the "Worst outstanding" button
  (search `Worst outstanding`, ~line 986) and the empty-state "next up" jump
  (search `nextUp`, ~line 1066). Both filter/sort `availableDates` by
  `attentionCount`.

**Do.**

1. Add `slotCount: number` (or a derived `isProduction: boolean`, your call —
   `isProduction = slotCount > 0`) to `ServiceDateOption`, and populate it in
   `listInstrumentServiceDates` from `d.slotCount`.
2. In `TriageView`, exclude non-production dates (`slotCount === 0` /
   `!isProduction`) from **both** steering selectors — the "Worst outstanding"
   button and the empty-state "next up" jump. A date you can't act on must never
   be the thing the UI tells you to go fix next.
3. Leave the **date picker `<select>`** showing all dates (a non-production date
   is still reachable manually), but drop its inline `· {attentionCount}` suffix
   for non-production dates — that count is unactionable, so don't advertise it
   there. The existing non-production headline copy ("… sit on a non-production
   plan — nothing to clear in service order.") already explains the state once
   you land there; keep it.

**Acceptance.** From a production date, "Worst outstanding" never points at a
`slotCount === 0` date. Landing on a non-production date still shows the
explanatory headline and doesn't crash. Counts shown anywhere are counts you can
act on.

## Task 2 — Branded error and not-found routes

**Problem.** No `error.tsx` or `not-found.tsx` exists, so a bad URL or a thrown
error drops the user onto Next.js's unstyled default page — an off-brand dead
end for a "presentation-grade" tool. `notFound()` is already called in
`variance/[campus]/page.tsx` and `[serviceDate]/page.tsx`.

**Where.** Create files under `src/app/`:

- `src/app/not-found.tsx` — server component.
- `src/app/error.tsx` — **must** start with `"use client"` (Next.js requires
  error boundaries to be client components) and accept
  `{ error, reset }: { error: Error & { digest?: string }; reset: () => void }`.

**Do.** Build both on the existing glass shell so they match the app. Reuse the
`.app-page`, `.app-page--center`, `.glass-card`, `.btn`, `.btn--primary`,
`.btn--ghost`, `.instrument-title`, `.instrument-subtitle`, and `.muted`
classes — mirror the composition in `src/app/login/page.tsx`. Copy, sentence
case, plain and calm:

- **not-found**: a short "We couldn't find that page." + one line of reassurance
  + a primary link back to `/` ("This weekend at a glance") and a ghost link to
  `/variance` ("Service history"). Use `next/link`.
- **error**: "Something went wrong loading this view." + one line ("The Tech
  Team can look into it if it keeps happening.") + a primary button that calls
  `reset()` ("Try again") and a ghost link home. Do not print `error.message`
  or the stack to the user.

**Acceptance.** Visiting a nonexistent route (e.g. `/variance/ZZZ`) renders the
branded not-found on the glass background, not the default Next.js page. Both
files typecheck; `error.tsx` has the `"use client"` directive.

## Task 3 — Navigation loading feedback

**Problem.** Every instrument/variance route is `export const dynamic =
"force-dynamic"` and does server work, so navigations can hang with zero
feedback — the old screen just sits frozen. Clicks feel dead.

**Where / do.** Add App Router `loading.tsx` files so React shows an instant
fallback during the server render:

- `src/app/(instrument)/loading.tsx` — covers Glance / Workbench / Triage.
- `src/app/(viewer)/loading.tsx` — covers the variance history surfaces.

Keep them lightweight and on-brand: a centered, low-key glass skeleton or a
quiet "Loading…" on the glass background (reuse `.app-page app-page--center`,
`.muted`). **Motion rule:** if you add any pulse/shimmer, it must degrade under
`@media (prefers-reduced-motion: reduce)` — the app already has a global
reduced-motion block in `globals.css`, so prefer CSS that inherits that, and
don't animate layout properties (transform/opacity only). A static skeleton is
perfectly acceptable and safest.

**Acceptance.** A throttled navigation to `/instrument/workbench` shows the
fallback instead of a frozen screen. No layout shift when the real content
swaps in (skeleton roughly matches the page's top region, or is a simple
centered state).

---

## Verify before you're done

```bash
npm run typecheck   # must pass
npm test            # 63 tests, must stay green
npm run lint        # app code clean (pre-existing warnings under .github/.claude skill scripts are fine)
```

If a dev server helps, `npm run dev` and check `/login` (shared password is in
`.env.local` — never print or commit it), then Glance, a non-production date in
Triage, a bad URL, and a navigation.

## Commit

One commit per task or one for the pass — your call — but keep messages in the
repo's style (imperative subject, a short body explaining *why*). End each
commit message with:

```
Co-Authored-By: Codex <noreply@openai.com>
```

Do not push; leave commits local on `main` unless told otherwise. Do not start
the polish pass.

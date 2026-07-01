# Build Plan — Design unification (one glass theme, readable, consistent)

**Status:** In progress (Part 1 shipped 7c7505d; Part 2 shipped b0a36c7/e6dac35/9d5a234; Part 3.2–3.4 shipped e98bd39/f39bca8/7630fb5; started 2026-06-30)
**Audience:** Implementing engineer / codex (self-contained — no prior session context needed)
**Repo:** `servicetimes` (Next.js 16 App Router + React server components + Supabase, deployed on Vercel)
**Origin:** Design review on 2026-06-30, run against the **Impeccable** ECC design context (warm, app-like, readable-first for a non-technical leadership audience; Planning Center / Linear register, not a developer dashboard).

> **Do not write code from this file blindly.** Read each referenced source file first. Follow the repo rule in `AGENTS.md`: this is not stock Next.js — check `node_modules/next/dist/docs/` before touching routing/layout/font APIs.

---

## The one-sentence goal

The product is currently **two visually contradictory apps** — a polished light **glass** theme on `/instrument/*` and a dark **neon-on-zinc** theme on everything else (`/`, `/login`, `/variance/*`). **Unify the entire product onto the glass light theme**, then raise readability and consistency to the Impeccable bar.

## Scope (what this plan covers)

- **Part 1 — Theme unification (P0):** migrate every dark/neon surface to the glass light theme. Delete the dark theme.
- **Part 2 — Readability (P1):** enforce a legible type scale, fix low-contrast text, and make charts readable/accessible.
- **Part 3 — Design consistency (P2):** replace scattered inline styles with a shared token + class system; unify the semantic color language across both halves.
- **Part 4 — Interaction states (P2):** consistent hover/focus/active states and adequate tap targets everywhere.

## Explicitly OUT of scope (do not do these)

- **Do NOT remove or reduce the glassmorphism.** The operator likes the glass vibe. Keep translucency, blur, the backdrop glows, and the glass cards.
- **Do NOT warm-shift or re-hue the existing light palette.** Keep the current lavender/cool glass background (`instrument.css` `--glass-bg`) as-is. The review flagged it as cool-not-warm; the maintainer has chosen to keep it. Leave the hues alone.
- **Do NOT redesign layouts or information architecture.** No new screens, no moved features. This is a re-skin + polish pass, not a rebuild.
- **Do NOT introduce a dark mode toggle.** One theme: glass light.

## Guiding principle

Reuse `instrument.css`'s existing token + class system as the single source of truth. **Less code that achieves the same result is better.** Every dark surface should end up rendering through the *same* tokens and classes the instrument already uses — not a parallel copy.

---

## Related build plans (read these; know their status)

This plan does not exist in isolation. As of 2026-06-30 the other plans in `docs/` stand at:

- **`ux-review-fixes-build-plan.md`** — 🟡 partially implemented. **Item 2.8 (refactor Triage's inline styles + hardcoded color literals) is folded into Part 3 of this plan** — do it here, not there. Still open there and unrelated to this plan: 2.6 (responsive grid collapse) and 2.7 (element display-name leak). Don't undo its shipped fixes: 2.1 minus sign, 2.3 focus rings, 2.4 disabled steppers, 2.5 labeled date picker (see Part 4.2 — extend, don't remove them).
- **`operator-upgrades-build-plan.md`** — ✅ fully implemented (2026-06-28). Historical record.
- **`product-layer-build-plan.md`** — ✅ Phases 0–2B implemented (2026-06-28); Phase 3 not started. The viewer variance pages this plan reskins were built under its Phase 1.
- **`instrument-build-plan.md`** — ✅ complete. The glass theme + classes this plan promotes app-wide originate here.

## Documentation discipline (a rule, not a suggestion)

**Keep the docs in lockstep with the work. As each Part/item of *this* plan is completed:**

1. **Update this plan.** Mark the completed Part/item with `✅ shipped (<commit-hash>)` in its heading, exactly like the checked-off items in the sibling plans. When the whole plan is done, change the top `**Status:**` line from "Ready to implement" to `✅ Implemented (<date>)` and note it's a historical record.
2. **Update any doc this work touches or supersedes.** In particular, when Part 3 lands, mark `ux-review-fixes-build-plan.md` item 2.8 `✅ shipped` with the commit — that item explicitly points here.
3. **Never leave a status line lying.** A doc that says "Ready to implement" or "in progress" for work that has shipped is a bug. If you ship it, say so in the same commit (or the immediately following docs commit), with the commit hash.
4. **When a new plan supersedes or absorbs part of an older one, cross-link both directions** (as this plan and the ux-review plan now do for item 2.8).

The bar: at any moment, a reader should be able to trust every doc's `Status` line and per-item markers without checking `git log`.

---

## Current-state map (verified 2026-06-30)

**Glass light theme (keep, promote to shared):**
- `src/app/(instrument)/instrument.css` — all design tokens (`:root`), glass primitives (`.glass-card`, backdrop glows), and component classes (pills, segment controls, phase bars, etc.). Imported **only** by the instrument layout today.
- `src/app/(instrument)/layout.tsx` — applies `instrument-root`, the backdrop glow layer, and the **Sora** font.

**Dark / neon theme (migrate, then delete):**
- `src/app/globals.css` — root `:root` sets `--background: #09090b` (near-black) + `--foreground: #f4f4f5`; `body` is dark. This is imported by the **root** layout, so it themes the whole app by default.
- `src/app/layout.tsx` — root layout; imports `globals.css`; no font set.
- `src/app/page.tsx` — home; `bg`/text via dark Tailwind utilities, `cyan-400` accents.
- `src/app/login/page.tsx` — login; `bg-zinc-950`, `cyan-400`, `zinc-*` text.
- `src/app/(viewer)/layout.tsx` — viewer shell; `bg-zinc-950 text-zinc-100`, `cyan-400` wordmark.
- `src/app/(viewer)/variance/page.tsx` — campus index; zinc cards, cyan hovers.
- `src/app/(viewer)/variance/[campus]/page.tsx` — service-date list; zinc cards, `amber`/`violet` status pills.
- `src/app/(viewer)/variance/[campus]/[serviceDate]/page.tsx` — service detail; zinc tables, `cyan`/`amber`/`violet` accents.

**Fonts:** instrument uses `Sora` (via `next/font/google`); the dark surfaces use the default sans. After unification the **whole app** should use Sora.

---

## Part 1 — Theme unification (P0) — ✅ shipped (7c7505d)

Severity legend: **P0** blocks the "one product" goal · **P1** readability · **P2** consistency/interaction.

### 1.1 — Establish a single shared theme layer *(do this first; everything else builds on it)* — ✅ shipped (7c7505d)

Right now the glass tokens/classes live in `instrument.css`, imported only on instrument routes. To theme the viewer/home/login with the same system, the tokens and shared primitives must be available app-wide.

- **Promote the shared layer.** Move the design **tokens** (`:root` block) and the **cross-surface primitives** (`.glass-card`, the backdrop-glow classes, and any typography/pill/button classes introduced in Part 3) into a stylesheet imported by the **root** layout (`src/app/layout.tsx`) so all routes inherit them. Keep instrument-only view classes (e.g. `.glance-*`, `.wb-*`, `.triage-*`) in `instrument.css`.
  - Simplest structural option: rename/repoint so the root layout imports the shared token+primitive stylesheet, and `instrument.css` `@import`s or assumes it. Avoid duplicating the `:root` token block in two files — one definition only.
- **Retheme the root shell.** In `src/app/globals.css`, the root `--background`/`--foreground` and `body` rules currently force dark. Change the app's default surface to the glass light background (reuse `--glass-bg` and `--ink`, do not invent new colors). Keep Tailwind's `@import "tailwindcss";` — the viewer pages still use Tailwind utilities for layout (spacing/grid/flex); only the **color/theme** utilities are being replaced.
- **Apply Sora app-wide.** Move the `Sora` font setup so it applies at the root layout (or a shared shell), so home/login/viewer match the instrument. Confirm the correct `next/font` usage against the installed Next docs before moving it.
- **Acceptance:** loading `/`, `/login`, and `/variance` shows the warm/soft glass background and Sora type — no near-black backgrounds anywhere. `instrument.css` no longer defines the token `:root` block a second time.

### 1.2 — Migrate `/login` — ✅ shipped (7c7505d)

`src/app/login/page.tsx` — the first impression. Currently `bg-zinc-950` card, `cyan-400` eyebrow/button, `zinc` inputs.
- Reskin the card as a `.glass-card`, the eyebrow/heading with the shared eyebrow/title classes, the submit button with the shared primary-button class (Part 3), and the password input with a glass input treatment (reuse the input styling introduced for Triage forms in Part 3, not a bespoke one).
- Replace `cyan-*` with `--accent`; replace `amber-*` error styling with the shared review/warning token.
- **Acceptance:** login is visually part of the glass family; no `zinc-*`, `cyan-*`, or `#09090b`-adjacent colors remain in this file.

### 1.3 — Migrate the home page — ✅ shipped (7c7505d)

`src/app/page.tsx` — currently dark hero with two `cyan`/`zinc` buttons.
- Reskin the hero using instrument hero classes (`instrument-eyebrow`, `instrument-title`, `instrument-subtitle`) or their shared equivalents, on the glass background.
- Convert both CTAs to shared button classes (primary = accent, secondary = ghost).
- **Acceptance:** `/` reads as the same product as `/instrument/glance`.

### 1.4 — Migrate the viewer shell — ✅ shipped (7c7505d)

`src/app/(viewer)/layout.tsx` — currently `bg-zinc-950 text-zinc-100`, cyan wordmark, zinc sign-out.
- Reskin the shell to match `InstrumentNav` (`src/components/instrument/InstrumentNav.tsx`) as closely as the viewer needs: glass sticky header, brand mark/wordmark, ghost sign-out button. Consider reusing the instrument nav's classes.
- Add the same backdrop-glow layer the instrument layout renders, so the viewer background has the same depth.
- **Acceptance:** the viewer chrome is visually continuous with the instrument chrome.

### 1.5 — Migrate the three variance pages — ✅ shipped (7c7505d)

- `src/app/(viewer)/variance/page.tsx` (campus index)
- `src/app/(viewer)/variance/[campus]/page.tsx` (service-date list)
- `src/app/(viewer)/variance/[campus]/[serviceDate]/page.tsx` (service detail + element table)

For each:
- Replace `border-zinc-800 bg-zinc-900/40` cards with `.glass-card`.
- Replace `cyan-*` links/accents with `--accent`; replace `font-mono` eyebrows with the shared eyebrow typography (the instrument uses Sora uppercase tracked labels, not monospace).
- Replace the `amber`/`violet` status pills with the **unified semantic pills** from Part 3.5 (so "review" and "unmapped" look identical to how Triage/Glance render them).
- The element **table** in the service-detail page must adopt the unified data-table styling from Part 3.4 (and meet the Part 2 type/contrast floors).
- **Acceptance:** all three pages use `.glass-card` + shared classes; no `zinc-*`/`cyan-*`/`violet-*` color utilities remain; status colors match the instrument.

### 1.6 — Delete the dead dark theme — ✅ shipped (7c7505d)

- After 1.1–1.5, remove the now-unused dark declarations from `globals.css` (the `#09090b` background/foreground and any dark-only `@theme` colors) so the dark theme cannot resurface.
- Grep the repo for `zinc-`, `cyan-`, `#09090b`, `text-cyan`, `bg-zinc` and confirm zero remaining matches in `src/app/**` (outside of intentional neutral usage, if any).
- **Acceptance:** `rg -n "zinc-|cyan-|#09090b" src/app` returns nothing meaningful.

---

## Part 2 — Readability (P1) — ✅ shipped (b0a36c7/e6dac35/9d5a234)

Audience test for every change here: **"Would Nate read this in a meeting without squinting or asking what it means?"**

### 2.1 — Enforce a legible type scale (no more 8–10px content) — ✅ shipped (b0a36c7)

The instrument and viewer are littered with `fontSize: 8/9/10` inline styles (e.g. `WorkbenchView.tsx` 8px "ADJ" tag ~L447; 9px eyebrows/labels throughout; `GlanceView.tsx` 10px recommendation *detail* ~L218; `TriageView.tsx` 9px chips/labels throughout).

- **Define a type scale as tokens** and route all text through it. Recommended floors:
  - Body / data values: **≥ 13px** (table cells, deltas, durations, verdicts).
  - Secondary text (detail lines, captions): **≥ 12px**.
  - Micro-labels / eyebrows / pill text (uppercase, tracked): **≥ 11px** — this is the absolute floor, only for short all-caps labels.
  - **Nothing renders below 11px.** The 8px "ADJ" badge and all 9px content must move up to ≥ 11px.
- Replace inline `fontSize` numbers with the scale tokens/classes as you extract classes in Part 3.
- **Acceptance:** `rg -n "fontSize: ?([0-9]|10)\b" src` returns nothing; no computed font-size in the rendered UI is below 11px.

### 2.2 — Fix low-contrast text — ✅ shipped (e6dac35)

- `--ink-55` (55% ink) and `--ink-35` (35% ink) are used for meaningful small text; some places stack `opacity: 0.75–0.8` on already-muted amber (`GlanceView.tsx` ~L474; `WorkbenchView.tsx` ~L838). At small sizes these fail WCAG AA (needs ≥ 4.5:1 for text < ~18px).
- **Add a darker muted token** (e.g. an `--ink-70`) and use it for any small text that currently uses `--ink-55`/`--ink-35` to convey real information. Reserve `--ink-35` for genuinely decorative/disabled states only.
- **Remove stacked `opacity` on text.** Bake the intended lightness into the color token instead so contrast is predictable.
- **Verify** each foreground/background pair used for text meets **AA (4.5:1)** against the glass surface it sits on (account for the translucent card over the gradient — test against the effective composited background, not pure white).
- **Acceptance:** every text token/background pair in the UI passes AA at its rendered size; no `opacity` on text-bearing elements below 1 except intentional disabled states.

### 2.3 — Make charts readable and accessible — ✅ shipped (9d5a234)

All charts are currently `aria-hidden` with no tooltips, hover, or value labels: `TrendChart` (`WorkbenchView.tsx` ~L50–194), the phase bars (`GlanceView.tsx` ~L417 / `WorkbenchView.tsx` ~L717), `DivergingBar` (~L196), `CrossMedianBars` (~L270). A leader can see a shape but cannot read a number — this violates "shouldn't need a legend to understand at a glance" and "interactivity signals confidence."

- **Trend chart:** add (a) endpoint/axis value labels (min/median/max delta and the date range), and (b) **hover tooltips** on each point showing service date + actual + delta. Give it an accessible name and a text alternative (a visually-hidden summary or data table) instead of blanket `aria-hidden`.
- **Phase bars & diverging bars:** add hover tooltips (phase name + planned vs actual + delta) and an accessible label. The phase legend chips already show values — ensure the bar itself is not the only place a value lives.
- **Cross-median bars:** add value labels (already partially present) + hover state; ensure the active campus is distinguishable by more than color.
- **Do not** pull in a chart library (the brand anti-reference names "generic chart libraries"); extend the existing hand-rolled SVG.
- **Acceptance:** every chart has a hover affordance revealing exact values, visible reference labels, and a non-visual text alternative; no chart conveys data through color alone.

---

## Part 3 — Design consistency (P2)

### 3.1 — Extract repeated inline styles into shared classes

`GlanceView.tsx`, `WorkbenchView.tsx`, and `TriageView.tsx` rebuild the same visual primitives inline dozens of times with magic numbers. The same accent "Save/Map/Correct/Map" button is hand-copied ~6× in `TriageView.tsx`; ghost "Keep/Exclude/Undo/Unmap" buttons another ~5×; status pills and eyebrow labels are re-declared everywhere.

Introduce a small shared class vocabulary (in the shared stylesheet from 1.1) and replace inline styles with it:
- **Buttons:** `.btn`, `.btn--primary` (accent fill), `.btn--ghost` (outline), with shared padding, radius, letter-spacing, and states. Adequate tap target (see Part 4).
- **Pills / chips:** one `.pill` base + status modifiers (see 3.5).
- **Typography:** classes for eyebrow, section label, metric label, data value (tabular), caption — mapped to the Part 2.1 scale.
- **Glass tile:** the workbench bento tiles repeat `glass-card` + `border-radius: var(--r-card)` + `padding: 18px 20px` inline (~7×) — make a `.glass-tile` class.
- **Inputs / selects:** one glass input/select treatment reused by Triage forms and the login password field.
- **Acceptance:** no repeated inline-style object appears more than twice; `rg -n "style=\{\{" src/components/instrument` count is materially reduced; buttons/pills/inputs render from shared classes.

### 3.2 — Replace magic numbers with tokens — ✅ shipped (e98bd39)

Spacing, radii, and colors are hardcoded inline (e.g. `padding: "18px 20px"`, `borderRadius: 999`, `rgba(28,32,48,0.08)` repeated ~30×).
- Add spacing/radius tokens where a value recurs; reuse existing `--r-card`/`--r-glance`/`--r-pill`.
- The repeated `rgba(28,32,48,0.xx)` hairlines/fills should become named tokens (e.g. a `--hairline`, `--fill-subtle`) so they're consistent and tunable.
- **Acceptance:** `rg -n "rgba\(28,?32,?48" src/components` collapses to a handful of token definitions, not ~30 inline literals.

### 3.3 — De-duplicate the campus color source — ✅ shipped (f39bca8)

`WorkbenchView.tsx` re-declares `CAMPUS_COLORS` in JS pointing at the same CSS vars already defined in `instrument.css` (`--slp/--mg/--elk/--lv`) and `.campus-dot--*` classes. Pick one source of truth (prefer the CSS vars/classes) and delete the JS duplication where a class will do.
- **Acceptance:** campus colors are defined once; the JS map, if it must stay for inline SVG fills, references the tokens rather than restating hex-equivalents.

### 3.4 — Unify the data-table styling — ✅ shipped (7630fb5)

Two different tables exist: the instrument element table (`WorkbenchView.tsx` `ElementTable`, inline grid) and the viewer element table (`variance/[campus]/[serviceDate]/page.tsx`, Tailwind `<table>`). They should share one visual language (header treatment, row hairlines, tabular numerics, section grouping, delta coloring).
- Define shared table/row classes and apply to both. The viewer table should look like the instrument table's family.
- **Acceptance:** both tables render with the same header style, hairlines, and delta color semantics.

### 3.5 — Unify the semantic color language *(cross-cutting; the viewer migration in 1.5 depends on this)*

The two halves speak different color languages for the same concepts:

| Concept | Instrument today | Viewer today | **Unify to** |
|---|---|---|---|
| Over target / incident | `--over` (red) | `amber`/`cyan` mix | `--over` |
| Under / on-target / good | `--under` (green) | `zinc` | `--under` |
| Needs review | `--over` / amber | `amber-*` | one **review** token (amber family) |
| Unmapped | `--amber-text` | `violet-*` | one **unmapped** token — **not** violet |
| Accent / links | `--accent` (teal) | `cyan-400` | `--accent` |

- Define the canonical status tokens once and use them in **both** halves. Resolve the unmapped-vs-review collision: pick distinct, consistent hues (e.g. review = amber, unmapped = a distinct but on-palette hue — decide once, apply everywhere). Drop `violet` and `cyan` entirely.
- **Acceptance:** "needs review" and "unmapped" render in the same color on Glance, Triage, Workbench, and the variance pages. No `cyan`/`violet` anywhere.

---

## Part 4 — Interaction states (P2)

### 4.1 — Consistent hover states on all controls

Inline-built controls have no hover feedback: the Workbench campus selector (`WorkbenchView.tsx` ~L616–653), the trend metric toggles (~L858), and the many inline Triage buttons. The instrument's class-based controls (`.instrument-tab`, `.segment-option`, `.slot-picker__option`) do have hover — extend that to everything via the shared button/pill classes from Part 3.
- Every clickable element gets a visible hover state (background/border/color shift) consistent with the segment-control pattern.
- **Acceptance:** no interactive element is without a hover state; hover treatments are consistent across surfaces.

### 4.2 — App-wide focus-visible

The `:focus-visible` ring is scoped to `.instrument-root` (`instrument.css` ~L683). After unification the ring must cover the whole app (home, login, viewer).
- Move the focus-visible rule to the shared layer so it applies app-wide; keep the special glance-header inset treatment.
- **Acceptance:** keyboard-tabbing through `/`, `/login`, and `/variance` shows a consistent accent focus ring on every focusable element.

### 4.3 — Adequate tap targets

Many inline buttons use `padding: "2px 6/7/8px"` and 9px text — well below a comfortable target. As controls move to `.btn`/`.pill` classes, set a minimum interactive height (~28–32px min, generous horizontal padding) while keeping the compact look.
- **Acceptance:** all buttons/toggles meet a minimum ~28px interactive height; date steppers and metric toggles are comfortably clickable.

### 4.4 — Active/disabled states

- Ensure disabled states (e.g. the Triage prev/next date steppers, already handled with opacity) use a shared disabled treatment, not per-instance opacity magic numbers.
- **Acceptance:** disabled and active states come from shared classes, not ad-hoc inline opacity.

---

## Suggested execution order

1. **Part 1.1** (shared theme layer) — unblocks everything.
2. **Part 3.5** (semantic tokens) + **Part 3.1–3.2** (shared button/pill/typography/table classes) — build the vocabulary before repainting.
3. **Part 1.2–1.6** (migrate + delete dark theme) — now trivial because the classes exist.
4. **Part 2** (readability: type scale, contrast, charts).
5. **Part 4** (interaction states) — largely falls out of the shared classes; finish the chart hovers.
6. **Part 3.3–3.4** cleanup passes.

## Global acceptance criteria (done = all true)

- One theme. `rg -n "zinc-|cyan-|violet-|#09090b" src/app src/components` returns nothing meaningful.
- One product feel: `/`, `/login`, `/variance/*`, and `/instrument/*` are visibly the same glass family (background, Sora type, glass cards, shared chrome).
- Glass and the existing light palette are preserved (no de-glassing, no hue changes).
- No rendered text below 11px; all text passes WCAG AA at its size.
- Every chart has hover-readable values, reference labels, and a non-visual text alternative.
- Status colors are unified across all surfaces; buttons/pills/inputs/tables render from shared classes, not repeated inline styles.
- Every interactive element has consistent hover + focus-visible states and an adequate tap target.
- `npm run lint`, `npm run build`, and `npm test` pass.
- **Docs are in lockstep** (per *Documentation discipline* above): this plan's completed items are marked `✅ shipped (<commit>)`, its `Status` line reflects reality, and `ux-review-fixes-build-plan.md` item 2.8 is marked shipped once Part 3 lands.

## Notes for the implementer

- Follow `AGENTS.md`: verify Next.js layout/font/CSS-import behavior against `node_modules/next/dist/docs/` — APIs may differ from stock Next.
- Tailwind stays for **layout** utilities (grid/flex/spacing/max-width) on the viewer pages; only **color/theme** utilities are being removed. You do not have to convert every Tailwind class to CSS — just the ones carrying the dark theme.
- This is a re-skin + polish pass. If a change tempts you to move a feature or alter data/logic, stop — it's out of scope.
- Cross-check against the earlier `docs/ux-review-fixes-build-plan.md` so you don't undo its focus-ring, minus-sign, or responsive-collapse fixes.
- Follow the **Documentation discipline** rule above as you go — update this plan's item markers/status and the sibling docs (esp. ux-review item 2.8) in step with the code, not after the fact.

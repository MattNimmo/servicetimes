# Build Plan — Operator UX fixes (Glance freshness + Triage review)

**Status:** Ready to implement
**Audience:** Implementing engineer (self-contained — no prior session context needed)
**Repo:** `servicetimes` (Next.js 16 App Router + React server components + Supabase, deployed on Vercel)
**Origin:** Design + usability review on 2026-06-29, checked against the design deliverable at `~/Desktop/design_handoff_service_times/README.md` (+ the `Service Times.dc.html` prototype).

---

## Context / Why

A review of the live instrument surfaced three threads:

1. **Glance showed a stale service date** (June 21 instead of the most-recent June 28). **Root cause diagnosed and resolved operationally** — see Part 1. No staleness *bug*, but a real product gap (no "newer service awaiting actuals" signal) and one latent fragility (run-through plan_times counted as "completed").
2. **Triage** has 2 behavior bugs that break documented deliverable behavior, plus a cluster of accessibility / usability / consistency gaps — Part 2.
3. **Already fixed, context only** — the Glance phase-legend contrast bug (commit `0819e9c`) and the operator-review→Triage consolidation (commit `15496a2`). Do **not** redo these; see "Already done."

Two findings (Part 1's run-through risk, Part 2.8's token drift) are flagged but **not required** — they're judgment calls for the maintainer.

---

## Part 1 — Glance freshness (June 28 didn't appear automatically)

### What happened (confirmed against prod DB + PCO API on 2026-06-29)

- The instrument only ingests the **latest *completed*** plan. `fetchLatestCompletedPlan` (`src/lib/pco/fetch-plan.ts:19`) fetches the last 10 past plans (`filter=past&order=-sort_date`) and returns the **first** one with a service `plan_time` where `time_type === "service"`, `recorded === true`, and live bounds (`live_starts_at`/`live_ends_at`) are present.
- When the Sunday cron + a manual pull ran at `2026-06-29T01:46Z` (8:46 PM CDT Sun), **June 28's broadcast times had not yet been entered in PCO**, so every June 28 service `plan_time` was `recorded=false`. The loop skipped June 28 and fell through to June 21 (Father's Day). `writesPerformed:4` was an idempotent re-upsert of the *same* June 21 plan IDs — not new data.
- Once the June 28 live times were entered (later that day), a re-pull picked June 28 up immediately. Verified: a `POST /api/pco/ingest` returned plan IDs `87624477` (ELK), `87961960` (SLP), `88778778` (MG), `88329295` (LV), and the DB now holds `service_date = 2026-06-28` for all four campuses.

**Conclusion: the cron, auth, fetch, and write path are all correct.** The staleness was a data-entry timing race, not a code defect. Operational fix when it recurs: confirm the Sunday plan's service times are `recorded` with live bounds in PCO, then trigger a pull:

```bash
curl -X POST https://servicetimes.vercel.app/api/pco/ingest -H "Authorization: Bearer $CRON_SECRET"
```

### Gap 1A — no "awaiting actuals" signal *(optional product work; build only if requested)*

The operator has no cue that a newer, not-yet-recorded service exists — Glance silently presents the last *completed* service as "latest." The design deliverable anticipated this with an **AWAITING SUNDAY** state, which was never wired because un-recorded plans are never ingested. To close it:

- **1A-i — ingest the latest plan even when not recorded (plan-only).** Add `fetchLatestPlan(serviceTypeId)` beside `fetchLatestCompletedPlan` (newest past plan regardless of `recorded`), or extend the existing fn to fall back to the newest past plan and tag the bundle `recorded: false`.
  - **Must verify:** the build/upsert path (`src/lib/pco/build-campus-plan.ts` + the ingestion RPC in `supabase/migrations/20260624020000_atomic_pco_ingestion.sql`) tolerates null `live_starts_at`/`live_ends_at` and null `actual_service_seconds`.
  - **Must gate:** plan-only rows must **not** raise `missing_live_bounds` / `zero_live_window` incidents (those imply "should have actuals but doesn't"). Gate incident creation on `recorded`. This changes incident semantics — scope carefully; it is the substantive part of 1A.
- **1A-ii — Glance awaiting state.** In `getGlanceData` (`src/lib/instrument/queries.ts`) / `GlanceView`, when the latest plan has no recorded actuals, render the deliverable's **AWAITING SUNDAY** treatment (planned totals + "Awaiting Sunday actuals" pill, optionally the prior completed service for reference). Do not fabricate a variance-vs-target.

**Recommendation:** leave 1A unbuilt unless the operator explicitly wants to see upcoming plans before actuals land. It is a real feature with incident-semantics implications, not a quick fix.

### Gap 1B — run-through plan_times count as "completed" *(latent fragility; fix recommended, low effort)*

June 28's ELK plan (`87624477`) carries a `plan_time` named **"Full Service Run Through"** with `time_type === "service"`, `recorded === true`, and live bounds — i.e. a rehearsal that looks identical to a real service to `fetchLatestCompletedPlan`'s `hasCompletedService` check (`src/lib/pco/fetch-plan.ts:28`). It happened to be excluded from variance downstream by the non-production exclusion rules (`supabase/migrations/20260625150000_non_production_exclusion_rules.sql` + `…213000_expand_non_production_name_rules.sql`), so no harm *this* week — but plan **selection** is one mislabeled run-through away from choosing a plan on the strength of a rehearsal time.

- **Fix:** in `hasCompletedService`, exclude plan_times whose name matches the existing non-production/run-through patterns (reuse the same name-rule source the exclusion migrations use — do not hardcode a second copy). A plan should qualify as "completed" only on a recorded **production** service time.
- **Acceptance:** a plan whose only recorded service time is a run-through is **not** returned by `fetchLatestCompletedPlan`.

---

## Part 2 — Triage review findings

Severity: **BUG** = breaks documented deliverable behavior · **A11Y** = accessibility · **USABILITY** · **POLISH** · **MAINT** = maintainability.

| # | Finding | Severity |
|---|---|---|
| 2.1 | Resolution toast never fires (dead code) | BUG |
| 2.2 | Cumulative-time column uses hyphen, not U+2212 minus | BUG |
| 2.3 | No `:focus-visible` styles anywhere in the instrument | A11Y |
| 2.4 | Prev/Next date steppers not truly disabled at list ends | A11Y |
| 2.5 | Date `<select>` has no label + clashes with pill controls | USABILITY |
| 2.6 | Service-order grid has no responsive collapse | USABILITY |
| 2.7 | Mapped-row sub-note leaks the raw `element_key` | POLISH |
| 2.8 | Triage built from inline styles + hardcoded color literals | MAINT |

All file references are to `src/components/instrument/TriageView.tsx` unless noted.

### 2.1 — Resolution toast never fires *(BUG)*

Deliverable: *"Resolving any item flips it to ✓ RESOLVED, fires a toast, and decrements the nav badge."* `Toast` is mounted and `dismissToast` exists, but **`setToast("…")` is never called** — it is dead code. Root cause: every action is a server-action `<form>` post that ends in `redirect()`, so there is no client moment to fire a toast. The operator currently gets a full-page reload with **zero confirmation** after Keep / Exclude / Correct / Map / Undo / Unmap.

**Fix (works with the redirect-based architecture):** carry a toast token on the post-action redirect, read it on mount, fire the toast, then strip the param.

- In `src/lib/operator/review-actions.ts`, append a `toast` query param to each action's redirect target. Add a tiny helper and use it in every action's `redirect(...)`:
  ```ts
  function withToast(path: string, msg: string) {
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}toast=${encodeURIComponent(msg)}`;
  }
  // e.g. resolveReviewIncidentAction → redirect(withToast(redirectTo, resolution === "kept" ? "Kept" : "Excluded"));
  // mapItemToElementAction → "Mapped" · unmapItemAction → "Unmapped"
  // reopenReviewIncidentAction → "Reopened" · correct* → "Correction saved" · resolveSlotResolution* → "Slot resolved"
  ```
  Keep `safeRedirectPath` as the guard on the base path (it already restricts to `/instrument`).
- In `TriageView`, read the param on mount and clear it:
  ```ts
  import { useRouter, useSearchParams } from "next/navigation";
  // …
  const searchParams = useSearchParams();
  useEffect(() => {
    const msg = searchParams.get("toast");
    if (!msg) return;
    setToast(msg);
    router.replace(`/instrument/triage?campus=${campus}&date=${data.serviceDate}`);
  }, [searchParams, router, campus, data.serviceDate]);
  ```
**Acceptance:** every resolution shows the frosted toast bottom-center, auto-dismisses (already 4s in `Toast.tsx`), and the `?toast=` param does not linger in the URL.

### 2.2 — Cumulative time uses a hyphen, not the real minus *(BUG)*

Deliverable §Formatting: *"use the real minus `−` U+2212, not hyphen."* `formatDuration` honors this; `formatCumulative` does not (`TriageView.tsx:114`). Pre-service rows render `-2:30` instead of `−2:30`.

```ts
// TriageView.tsx ~line 114 — change the hyphen to U+2212:
return seconds < 0 ? `−${str}` : str;
```
**Acceptance:** negative cumulative times render with `−` (U+2212), visually matching `formatDuration` output.

### 2.3 — No focus-visible styles in the instrument *(A11Y)*

`grep focus src/app/(instrument)/instrument.css` returns nothing. Keyboard operators cannot see focus on any instrument control — and Triage is now the only operator tool. Add a single global rule scoped to the instrument:

```css
/* src/app/(instrument)/instrument.css */
.instrument-root :focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}
```
Verify the inline-styled `<button>`/`<select>`/`<input>` controls in `TriageView`, `CorrectModal`, and the pill controls all show a visible ring on Tab. (No inline `outline: none` exists today, so the rule applies cleanly.)
**Acceptance:** tabbing through Triage shows a clear focus ring on every interactive element.

### 2.4 — Prev/Next date steppers aren't truly disabled *(A11Y)*

At the ends of the date list the ‹ / › buttons drop to `opacity:0.3` but stay focusable with a live (no-op) click handler — they only guard inside `onClick` (`TriageView.tsx:770–806`). Use the real `disabled` attribute so they leave the tab order and expose disabled state to AT:

```tsx
<button
  type="button"
  disabled={!canPrev}
  onClick={() => navigateDate(availableDates[currentDateIdx + 1].serviceDate)}
  className="slot-picker__option"
  style={{ opacity: canPrev ? 1 : 0.3, cursor: canPrev ? "pointer" : "default" }}
  aria-label="Previous Sunday"
>‹</button>
// …and the symmetric Next button with disabled={!canNext}
```
**Acceptance:** at the first/last available Sunday the corresponding stepper is `disabled` (not tab-focusable, no click).

### 2.5 — Date `<select>` unlabeled + visually inconsistent *(USABILITY)*

In the date cluster (`TriageView.tsx:768–808`) the campus buttons and ‹ › steppers are pills (`slot-picker__option`, 999px radius) but the `<select>` between them is a 6px-radius box with ad-hoc rgba borders — two design languages in one control group — and it has no accessible name.

- Add `aria-label="Service date"` to the `<select>`.
- Align it with the pill language: give it `border-radius: 999px`, `border: 1px solid rgba(255,255,255,0.7)`, `background: rgba(255,255,255,0.56)` (or extract a `.date-picker__select` class in `instrument.css` — see 2.8). Keep the `· N` attention-count suffix in option labels.

**Acceptance:** the date picker reads as one cohesive pill control group and the `<select>` has an accessible name.

### 2.6 — Service-order grid has no responsive collapse *(USABILITY)*

The grid `74px 52px 1fr auto` is fixed at all widths (column header `TriageView.tsx:846`, `SectionHeaderRow`, `ItemRow`). Glance and Workbench have media queries; Triage has none. Below ~480px the action column (dropdown + 2–3 buttons) overflows. Triage's audience is desktop, so this is lower priority — but add a small-screen treatment:

- At `max-width: 560px`, drop the cumulative-time (`74px`) and/or `LEN` (`52px`) columns to a stacked sub-line under the title, leaving `TITLE | STATUS·ACTION`. Implement via a `.triage-row` class + media query in `instrument.css` rather than inline styles (ties into 2.8), and let the action cluster wrap.
**Acceptance:** at 390px width no row content is clipped or forces horizontal scroll.

### 2.7 — Mapped-row sub-note leaks the raw element key *(POLISH)*

Mapped rows show the raw `element_key` (e.g. `live.message`) as the sub-note (`TriageView.tsx:507–511`) — a technical artifact shown to a non-technical operator. Map it to a display name using the `availableElements` already passed into the view (each has `key` + `displayName`):

```tsx
// Build once near the top of TriageView: const elementName = new Map(data.availableElements.map(e => [e.key, e.displayName]));
// Then in the sub-note: {elementName.get(item.elementKey) ?? item.elementKey}
```
Thread the lookup (or a resolved `elementDisplayName` field) down to `ItemRow`.
**Acceptance:** mapped rows show a human-readable element name, not a dotted key.

### 2.8 — Inline styles + hardcoded color literals *(MAINT)* — ✅ shipped (`5b90fb1`) via `design-unification-build-plan.md` Part 3

Triage is built almost entirely from inline style objects with hardcoded rgba literals that duplicate existing tokens — `rgba(207,82,44,…)` = `--over`, `rgba(185,106,20,…)` = `--amber-text`, `rgba(46,156,107,…)` = `--under`, `rgba(28,32,48,…)` = `--ink*`. Glance uses the semantic class system in `instrument.css`; Triage does not, so tokens are re-hardcoded dozens of times and palette changes drift. (This is the same class of issue that caused the phase-legend contrast bug, now fixed.)

- **Recommended sweep:** extract Triage's repeated chips/rows/controls into `instrument.css` classes (`.triage-row`, `.triage-chip--{status}`, `.date-picker__select`, etc.) referencing `--over` / `--under` / `--amber-text` / `--ink*` (use `color-mix(in srgb, var(--over) 12%, transparent)` for the tint variants). This also unblocks 2.5 and 2.6 cleanly.
- Not user-visible; do it when touching this file, not as a standalone churn commit.

---

## Already done — do NOT redo (context)

- **Glance phase-legend contrast** — commit `0819e9c`. Legend chips were filled with the stacked-bar's solid colors + white text (Mid ~2.6:1, Local ~2.7:1, both failing WCAG AA). Now: solid fills scoped to `.phase-bar__segment` only; legend chips use a `.phase-chip__dot` swatch + ink text, Mid label+value in amber. The 2.8 sweep should catch any *remaining* hardcoded phase/over/under literals.
- **Operator-review → Triage consolidation** — commit `15496a2`. `/operator/review` and `review-queries.ts` were deleted; `/operator` redirects to `/instrument/triage`; the plan-time correction form moved inline into `SlotIncidentChip`.

---

## Verification

1. **Part 1 (already validated):** DB holds `service_date = 2026-06-28` for all four campuses; Glance/Triage show June 28. If building 1A/1B, add the acceptance checks noted inline.
2. **Typecheck + lint:** `npx tsc --noEmit` and `npm run lint` clean. (Clear `.next` first if stale route types complain.)
3. **Triage E2E (manual; needs an operator session + live Supabase — run `npm run dev` in this project):**
   - 2.1 — Keep/Exclude/Correct/Map/Undo/Unmap each show a toast; no `?toast=` left in the URL.
   - 2.2 — a pre-service row shows `−M:SS` with U+2212.
   - 2.3 — Tab through the page; every control shows a focus ring.
   - 2.4 — at the newest/oldest Sunday, the matching stepper is disabled.
   - 2.5 — date picker reads as one pill group; `<select>` has an accessible name.
   - 2.6 — at 390px no clipping / horizontal scroll.
   - 2.7 — mapped rows show display names.

---

## Commits (separate; commit on `main`, then `git push origin main`)

1. `fix(pco): exclude run-throughs from latest-completed selection` — Part 1B (only if building it)
2. `feat(glance): plan-only ingestion + awaiting-actuals state` — Part 1A (only if requested; may split into ingestion + UI)
3. `fix(triage): resolution toast + real minus sign` — 2.1 + 2.2
4. `fix(triage): focus rings + disabled date steppers + labeled date picker` — 2.3 + 2.4 + 2.5
5. `refactor(triage): responsive grid + element display names via instrument.css` — 2.6 + 2.7 (+ 2.8 sweep)

**Guardrails:** never amend; never `git add raw/`; keep filenames lowercase-hyphenated; never skip git hooks.

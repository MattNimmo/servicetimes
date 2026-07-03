# Build Plan — Broadcast Window + Worship Mapping Fixes

**Status:** ✅ **Implemented (2026-07-02)** — all four parts landed in one commit: P1 broadcast window from item timers, P2 `worship.communion` element + auto-map alias, P3 SLP post-communion song detach, P4 re-map lever + `element_variance` override-beats-rollup. Verified: `tsc` clean, 54 tests pass, lint clean.
**Audience:** Implementing engineer (self-contained — no prior session context needed)
**Repo:** `servicetimes` (Next.js 16 App Router + Supabase, deployed on Vercel)

---

## Context / Why

Four related problems surfaced while reviewing the **2026-06-28 SLP** service on the Workbench:

1. **The BROADCAST WINDOW is the wrong span.** It currently shows Planning Center's raw live block (`plan_times.live_starts_at → live_ends_at`), which spans the whole on-air period. The intended meaning — and what the hardcoded caption already *claims* — is **"the message block": from when the bumper video ends to when the message ends.** The label and the numbers disagree today.

2. **Communion placed inside the worship block goes UNMAPPED.** Element aliases are section-scoped, and there's no communion alias in `worship_open`. When communion runs under the **Praise & Worship** header (as on 6/28), the section resolves to `worship_open`, `element_key` is null, and the item lands in **UNMAPPED**. Correct as a safety net, but it should instead **auto-map to a communion element that lives inside worship**. (Offering does **not** run during worship at SLP, so it is out of scope here.)

3. **The post-communion worship song is silently dropped.** At SLP the worship set is often split by communion, and the **3rd song runs on its own timer** after communion (6/28: *Holy Forever*, 6:00). The rollup analyzer marks **every** song after the "Worship Bundle" parent (until the next header) as `is_rollup_child`, because a non-song item like Communion doesn't break the scan ([`ingestion-plan.ts:235-241`](../src/lib/pco/ingestion-plan.ts)). Rollup children are excluded from `element_variance`, so *Holy Forever*'s 6:00 (planned **and** actual) never reaches the worship total. The bundle's own timer had already closed, so nobody counts it.

4. **Auto-mapped items can't be re-mapped from the UI.** The "Map to…" control only renders for `status === "unmapped"` ([`TriageView.tsx:446`](../src/components/instrument/TriageView.tsx)). Auto-mapped (`good`) and `rolled_up` items have no correction lever, so there's no way to fix a wrong auto-mapping or pull a song out of a rollup.

**Outcome:** the broadcast window reflects the true message block; communion inside worship auto-maps and is tracked in worship; the post-communion song keeps its own timer and counts toward worship; and any item's mapping can be changed from Triage.

**Scope decisions (locked):**
- Broadcast window = **bumper end → message end**, derived from `item_times`; fall back to the current PlanTime bounds only when those item timers are missing.
- **Communion-in-worship gets its own worship-section element** (`worship.communion`) and auto-maps via alias. Offering is out of scope (it doesn't occur during worship at SLP).
- Post-communion song rule is **keyed to broadcast-origin campus (SLP)**, mirroring `campuses.is_broadcast_origin`.
- Re-mapping is exposed for **all** item statuses on Triage; a manual override must **beat the rollup flag** so a re-mapped song actually counts.

**Runtime taxonomy source of truth:** ingestion resolves aliases from the **`PCO_TAXONOMY` constant** in [`src/lib/pco/taxonomy.ts`](../src/lib/pco/taxonomy.ts) (wired at [`build-campus-plan.ts:9`](../src/lib/pco/build-campus-plan.ts)), **not** the `element_aliases` DB table. New aliases MUST be added to that constant. Add them to [`supabase/seed.sql`](../supabase/seed.sql) too, for consistency, but the constant is what actually runs.

---

## Part 1 — Broadcast window = bumper end → message end

### 1.1 Data: expose the two timestamps in the workbench query
**File:** [`src/lib/instrument/queries.ts`](../src/lib/instrument/queries.ts) (`getWorkbenchData`, ~640-745)

Today `slotSummary.broadcastStartsAt/EndsAt` come straight from `latestPlanTime.live_starts_at/ends_at` (lines 739-740). Replace those two fields with values derived from the live element timers:

- **Window start** = `live_end_at` of the **`live.bumper`** item's `item_times` row for this plan_time.
- **Window end** = `live_end_at` of the **`live.message`** item's `item_times` row for this plan_time.

The query already fetches `element_variance` rows (with `element_key` + `item_ids`) and `item_times` for the plan_time (`slotItemTimes`, lines 705-711). Two changes:
1. Extend the `slotItemTimes` select to include `live_start_at, live_end_at` (currently only `id, item_id`).
2. Resolve the bumper/message item ids from the `element_variance` rows (`element_key === "live.bumper"` / `"live.message"` → their `item_ids`), then read the matching `item_times.live_end_at`.

Add both to `ServiceSlotSummary`:
```ts
broadcastStartsAt: bumperEndAt ?? latestPlanTime?.live_starts_at ?? null,   // bumper end
broadcastEndsAt:   messageEndAt ?? latestPlanTime?.live_ends_at ?? null,    // message end
broadcastIsMessageBlock: bumperEndAt !== null && messageEndAt !== null,      // new flag for the caption
```
The fallback preserves today's behavior for campuses/plans without bumper+message timers (e.g. non-broadcast campuses, incomplete data).

### 1.2 UI: dynamic caption
**File:** [`src/components/instrument/WorkbenchView.tsx`](../src/components/instrument/WorkbenchView.tsx) (~651-660, 884)

The duration math (`(end − start)/60000`) is unchanged — it now naturally reflects the message block. Replace the hardcoded caption at line 884 with one driven by the new flag:
- when `broadcastIsMessageBlock`: **"BUMPER END → MESSAGE END · the on-air message block"**
- fallback: keep **"LIVE → END · full live block (message timers unavailable)"** so the display never lies about what it's showing.

### 1.3 Tests
- Unit: given `item_times` for `live.bumper` (ends 9:12a) and `live.message` (ends 10:16a), `slotSummary.broadcastStartsAt/EndsAt` = those two, duration = 64 min.
- Fallback: with no bumper/message item_times, falls back to PlanTime bounds and sets `broadcastIsMessageBlock = false`.

---

## Part 2 — Auto-map communion that occurs inside worship

### 2.1 New element — communion
**Migration:** `supabase/migrations/2026070216xxxx_worship_communion_element.sql` (idempotent upsert, same pattern as existing element seeds)

```sql
insert into public.elements (key, section_key, display_name, is_tracked, is_lever_eligible, applies_to_campuses, sort_order)
values
  ('worship.communion', 'worship_open', 'Communion (in Worship)', true, true, null, 30)
on conflict (key) do update set
  section_key = excluded.section_key,
  display_name = excluded.display_name,
  is_tracked = excluded.is_tracked,
  is_lever_eligible = excluded.is_lever_eligible,
  sort_order = excluded.sort_order;
```
This must exist so `map_item_to_element`'s section-membership check passes ([`20260628000000_map_item_to_element.sql:42-49`](../supabase/migrations/20260628000000_map_item_to_element.sql)) and so the "Map to…" dropdown lists it under WORSHIP. Mirror this row into [`seed.sql`](../supabase/seed.sql).

### 2.2 Alias so it auto-maps ("default there")
**File:** [`src/lib/pco/taxonomy.ts`](../src/lib/pco/taxonomy.ts) — add to `elementAliases`:
```ts
["worship_open", "communion", "worship.communion"],  // communion under worship → new worship element
```
Resolution is scoped to the active section header, so `"communion"` under **Praise & Worship** resolves to `worship.communion` and is tracked in Worship (status `good`) instead of sitting UNMAPPED. Mirror this into `element_aliases` in [`seed.sql`](../supabase/seed.sql) for consistency.

### 2.3 Tests
- `normalizePlanItems`: a "Communion" item under a "Praise & Worship" header → `elementKey === "worship.communion"`, section `worship_open`, `resolutionSource === "alias"`.
- Regression: a "Communion" item with no worship header (or elsewhere) is unaffected.

---

## Part 3 — Communion rule: don't roll up the post-communion song (SLP)

### 3.1 Rule
In the worship-bundle child scan, once a **communion item** has appeared, any **song after it** is a real tracked worship contribution with its own timer — **not** a rollup child. Songs *before* communion still roll up as today. Gate on **broadcast-origin campus** (`campus.is_broadcast_origin`, i.e. SLP), since that's where this pattern occurs.

### 3.2 Implementation
**File:** [`src/lib/pco/ingestion-plan.ts`](../src/lib/pco/ingestion-plan.ts)

- Thread campus into the analyzer: change `analyzeTimedBundles(bundle.items, normalizedById, assignments)` → `analyzeTimedBundles(bundle.items, normalizedById, assignments, campus)` (call site line 421; `campus` is in scope in `buildIngestionPlan`).
- In the child loop (currently only breaks on `header` and collects `song && length > 0`, lines 235-241): also walk **non-song** items, and when one resolves to communion (`normalizedById.get(child.id)?.elementKey === "worship.communion"` OR title `/communion/i`), set a `sawCommunion = true` flag. **Break only on header** as before.
- For each qualifying song:
  - if `campus.is_broadcast_origin && sawCommunion` → **do NOT** add to `rollupChildIds`; instead record `detachedWorshipSongIds.add(child.id)`.
  - else → `rollupChildIds.add(child.id)` (unchanged).
- Return the new set: `return { rollupChildIds, detachedWorshipSongIds, incidents }`.

**In `buildIngestionPlan`** (~421-494): for ids in `detachedWorshipSongIds`, when constructing the normalized item, force `elementKey = "worship.open"`, `sectionKey = "worship_open"`, `isRollupChild = false`. This makes the song's own planned length (e.g. *Holy Forever* 6:00) **and** its own timer sum into `worship.open` in `element_variance` — no double-count, because the pre-communion placeholder songs carry 0:00 planned and the bundle carries its own 10:00.

> **Why `worship.open` and not a new element:** the ask is literally "add its 6 min to the worship time." Folding it into `worship.open` does exactly that and keeps the Worship subtotal correct. If per-song granularity is wanted later, introduce `worship.post_communion` — noted as a future option, not in scope.

### 3.3 Tests
Extend [`ingestion-plan.test.ts`](../src/lib/pco/ingestion-plan.test.ts) (the existing bundle test at ~343-366):
- SLP plan: `[Praise & Worship header, Worship Bundle (len 600), Song A (0), Song B (0), Communion, Holy Forever (360)]`
  → Song A, Song B `is_rollup_child = true`; **Holy Forever `is_rollup_child = false`, `element_key = "worship.open"`.**
- Non-broadcast campus (e.g. ELK), same shape → Holy Forever still rolls up (rule is SLP-only).
- No communion present → all songs roll up as today (no regression).

---

## Part 4 — Re-map any item (incl. auto-mapped & rolled-up)

### 4.1 UI: show the lever for more statuses
**File:** [`src/components/instrument/TriageView.tsx`](../src/components/instrument/TriageView.tsx) (~446)

Render `MapActions` for `good`, `rolled_up`, **and** `unmapped` (keep `incident`/`resolved`/`not_tracked` on their existing controls). For `good`/`rolled_up`, present it as a **"Re-map"** affordance (secondary styling) rather than the primary "Map" CTA, so the common case (already-correct auto-mapping) isn't visually loud. The underlying `mapItemToElementAction` + `map_item_to_element` RPC already revoke any prior override and insert a new one — it works unchanged for auto-mapped items (the new override supersedes the auto-resolved `element_key`).

### 4.2 Data: an override must beat the rollup flag
**Migration:** `supabase/migrations/2026070216xxxx_variance_override_beats_rollup.sql` — recreate the `element_variance` view (current def in [`20260625120000_item_time_corrections.sql:18-71`](../supabase/migrations/20260625120000_item_time_corrections.sql)) changing the rollup exclusion:

```sql
-- before:
and i.is_rollup_child = false
-- after: a manual override re-includes an otherwise-rolled-up item
and (i.is_rollup_child = false or ibo.id is not null)
```
(`ibo` = the active `item_bucket_overrides` join already present in the view via `coalesce(ibo.element_key, i.element_key)`.) Without this, re-mapping a `rolled_up` song sets its `element_key` but `element_variance` still excludes it, so the time wouldn't move. This is also the **manual escape hatch** for any Part 3 edge case the automatic rule doesn't catch.

### 4.3 Tests
- Re-map an auto-mapped item to a different element → `element_variance` moves its planned/actual to the new element; audit row `item.mapped_to_element` written.
- Manually map a `rolled_up` song to `worship.open` → its time now appears in the worship total (validates 4.2).

---

## Migration & file summary

| # | Change | File(s) |
|---|--------|---------|
| P1 | Broadcast window from `item_times` (bumper end → message end) + fallback | `queries.ts`, `WorkbenchView.tsx` |
| P2 | New `worship.communion` element | new migration + `seed.sql` |
| P2 | Auto-map alias: communion→`worship.communion` | `taxonomy.ts` (runtime) + `seed.sql` |
| P3 | Post-communion song rule (SLP), detach + map to `worship.open` | `ingestion-plan.ts`, `ingestion-plan.test.ts` |
| P4 | Re-map lever for all statuses | `TriageView.tsx` |
| P4 | `element_variance`: active override beats `is_rollup_child` | new migration |

**Suggested sequencing:** P2 → P3 (P3 depends on the `worship.communion` element/alias existing) → P4 (view change) → P1 (independent, can land anytime). Each part is independently shippable and testable.

---

## Verification checklist (against the 2026-06-28 SLP plan)
- [ ] Broadcast window shows bumper-end → message-end; "MIN LIVE" recomputed; caption reads "BUMPER END → MESSAGE END".
- [ ] Communion under the worship header auto-maps to `worship.communion` and is tracked in Worship — no longer UNMAPPED.
- [ ] *Holy Forever*'s 6:00 (planned + actual) is included in the WORSHIP subtotal; it is no longer "↳ ROLLED UP".
- [ ] I can change *Communion*'s and any auto-mapped item's element from Triage, and the Element Breakdown totals move accordingly.

## Open questions
1. **Bumper-less campuses / plans:** window falls back to PlanTime bounds (§1.1). Confirm that's acceptable vs. hiding the window entirely when no message timer exists.
2. **Communion detection breadth:** gate is `worship.communion` element OR `/communion/i` title. Any other titles used at SLP (e.g. "The Lord's Supper", "Table")? If so, add aliases.

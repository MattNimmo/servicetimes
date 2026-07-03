# Build Plan — 12-Month Historical Backfill

**Status:** 📋 **Planned (2026-07-02)** — scope agreed with product owner (Matt).
**Audience:** Implementing engineer (self-contained — no prior session context needed)
**Repo:** `servicetimes` (Next.js 16 App Router + Supabase, deployed on Vercel; PCO Services API source)

---

## Context / Why

The instrument currently holds only recent Sundays. The Workbench trend horizons (6mo/12mo), the Glance 6/12-week pattern window, and any ecc-times-style analysis need **the last 12 months of production services** (~52 Sundays × 4 campuses ≈ 200+ plans) loaded into Supabase.

The blocker is not ingestion mechanics — it's **review burden**. A naive backfill would dump hundreds of unmapped items and incidents into Triage to be reviewed service-by-service. This plan avoids that.

**Core principle: review by *pattern*, not by service.** Across 52 weeks the services are structurally near-identical. One unmapped title ("Host Pastor//New Guest") recurring in 40 weeks is *one* decision, not 40. Every phase below is built around collapsing the review surface from ~200 services to ~15–30 distinct patterns plus a small exception queue.

**What already works in our favor (do not rebuild):**
- `ingest_pco_plan` RPC is **atomic and idempotent** — upserts on PCO IDs; re-running any plan is safe and produces no duplicates ([docs/ingestion-write-path.md](ingestion-write-path.md)).
- `buildIngestionPlan(campus, bundle, PCO_TAXONOMY)` applies all *current* logic to any bundle — historical plans get the communion rollup rule, tightened `bundle_overlap` trigger, and current aliases for free.
- `scripts/ingest-weekend.ts` already has the dry-run / `--commit` / `--verify` pattern and env guards.
- The unit of ingestion is a **whole PCO plan** (all slots land atomically).
- Non-production plan_times (rehearsals, run-throughs) are filtered by name rules both at fetch (`fetch-plan.ts`) and in variance views.

---

## Phase 0 — Backfill runner

**Files:** `scripts/ingest-weekend.ts` (extend), `src/lib/pco/fetch-plan.ts` (add range fetcher)

### 0.1 Range fetcher
`fetchLatestCompletedPlan` only returns the newest completed plan. Add:

```ts
export async function fetchCompletedPlansSince(serviceTypeId: string, sinceIso: string)
```
- Page through `/services/v2/service_types/{id}/plans?filter=past&order=-sort_date&per_page=25` (offset pagination) until `sort_date < since`.
- For each plan, reuse the existing bundle assembly (plan_times, items + item_times) and the existing `hasCompletedService` gate (production time_type, non-production name filter, live bounds present). Skip plans that fail the gate but **count them in the report** (see census) so nothing silently disappears.

### 0.2 CLI flags
| Flag | Meaning |
| --- | --- |
| `--since 2025-07-01` | Backfill window start (alternative: `--weeks 52`) |
| `--campus SLP` | Same as today; run one campus per invocation |
| `--commit` | Same guard as today (`ENABLE_PCO_INGESTION_WRITES=true` required); default is dry-run |
| `--journal <path>` | Append-only JSONL of processed PCO plan IDs + outcome; on restart, skip IDs already journaled (crash-resumable) |
| `--census <path>` | Write the aggregate dry-run report (Phase 1) instead of per-plan summaries |

### 0.3 Rate limiting
PCO allows ~100 requests/20s. ~200 plans × 3–5 requests ≈ 800+ requests. Throttle to a safe budget (e.g. 60 req/20s window, simple token bucket in `pcoGet`) and back off on 429. A full campus dry-run should take minutes, not fail halfway.

### 0.4 Idempotency stance
No special handling needed — the RPC upserts on PCO IDs. Re-running a journaled plan is wasteful but harmless. The journal exists to save API budget and wall-clock, not for correctness.

---

## Phase 1 — Dry-run census (zero writes — the decision-making artifact)

Run all 4 campuses × 12 months in dry-run with `--census`. Emit **one aggregate report** (markdown or JSON → markdown) with:

1. **Unmapped titles ranked by total planned time.** For each distinct `raw_title_normalized` that resolves to no element: occurrence count, total planned seconds, section(s) it appears under, campuses. This is the taxonomy shopping list — expect a Pareto where ~15 titles cover ~95% of unmapped minutes.
2. **Incident histogram** by kind × campus (`missing_item_end`, `reconciliation_gap`, `zero_allotment`, `timer_bleed`, `bundle_overlap`, `missing_live_bounds`, `zero_live_window`).
3. **Slot-resolution failures** — plan_times that match no configured slot. Service-time changes during the year (added/removed slots, time shifts) surface here; decide per pattern whether to add a historical slot or exclude.
4. **Skipped plans** — plans failing the completed-service gate (no production time, no live bounds), listed with reasons, so the "missing weeks" in trends are explainable.

**Exit criteria:** the census is reviewed and every high-volume pattern has a decision (alias / new element / exclude / accept).

---

## Phase 2 — Taxonomy hardening (one commit)

From the census:
- Add the winning aliases to **`src/lib/pco/taxonomy.ts`** (the runtime source of truth — NOT just the DB tables) and mirror in `supabase/seed.sql` + a migration for `element_aliases`/`section_aliases` consistency.
- Add any genuinely new elements (same pattern as `worship.communion`: element row + alias + migration).
- Add historical slots or name-rule exclusions for slot-resolution patterns.
- **Re-run the Phase 1 dry-run census.** Residual unmapped tail should be trivial (< ~5% of planned minutes). Iterate once if not.

Unit tests: one `normalizePlanItems` case per newly aliased title family (same style as the communion tests in `normalize.test.ts`).

---

## Phase 3 — Committed backfill + completeness scorecard

### 3.1 Run it
Campus by campus, oldest-first, with `--commit --journal`. Spot-check the first campus (`--verify` on a few plans) before running the rest.

### 3.2 Scorecard (query or view — no new UI yet)
Per plan_time, compute a mechanical grade:

| Check | Green threshold |
| --- | --- |
| Production live bounds present | yes |
| Reconciliation gap (Σ item timers vs live window) | ≤ 60s |
| Planned seconds mapped to tracked elements | ≥ 95% |
| Tracked-element actuals complete (`actual_is_complete`) | yes |

Implement as a SQL view (`backfill_quality`) over existing views (`effective_plan_times`, `element_variance`, `unmapped_items`) — all inputs already exist. **Green = auto-accepted, no human review.** Yellow/red only enter the queue. Expect a strong Pareto after Phase 2 (~80%+ green).

### 3.3 Trend safety
Nothing extra needed: `element_variance.actual_is_complete` and the phase-breakdown `sumNullable` semantics already exclude incomplete weeks from aggregates, so red weeks degrade trends gracefully instead of poisoning them.

---

## Phase 4 — Exception review + bulk resolution

### 4.1 Review queue (small)
Triage already computes per-Sunday attention counts in its date dropdown. Add a sort/landing affordance: list backfilled Sundays **worst-first** (by attention count or scorecard grade) so the operator burns down the exceptions in order. No new data plumbing.

### 4.2 Bulk incident resolution (one RPC + one button)
Nobody will correct a timer from last September. Add `bulk_resolve_review_incidents(p_kind, p_before_date, p_resolution, p_actor)`:
- Sets matching **open** incidents to `kept` (accept-as-is), audited as one `admin_audit_log` row with the count + filter in `after_state`.
- UI: a small control on Triage (operator-only), e.g. "Keep all `zero_allotment` older than 8 weeks".
- Guardrails: only non-slot-blocking kinds; require an explicit kind (no "all kinds"); date bound required.

### 4.3 Sampling QA
Before trusting the corpus: hand-check ~10 randomly sampled services (mix of campuses/months) against the PCO UI — live window, 2–3 item timers, worship totals. If 10 random services are right, the pipeline is right.

---

## Sequencing & effort

| Phase | Size | Deliverable |
| --- | --- | --- |
| 0 | 1 script + fetcher | Resumable, throttled backfill runner |
| 1 | report generation in the runner | Census markdown — the decision doc |
| 2 | taxonomy commit + tests | ~95%+ auto-mapping on history |
| 3 | run + 1 SQL view | Data loaded + `backfill_quality` grades |
| 4 | 1 RPC + small UI + manual QA | Exception queue burned down |

Hard order: 0 → 1 → 2 → (re-run 1) → 3 → 4. Do **not** commit any historical data before Phase 2 lands — otherwise the unmapped backlog materializes in Triage and the pattern-level review advantage is lost.

## Open questions
1. **Slot history:** if any campus changed service times during the year, do we add historical slots (accurate per-week resolution) or exclude those weeks? Census will size the problem.
2. **Bulk-keep threshold:** default cutoff for "too old to correct" — 8 weeks?
3. **Retroactive June-28-style fixes:** backfill re-ingests recent weeks too (idempotent). Confirm we *want* current rules (communion rollup detach etc.) applied to already-reviewed recent Sundays — recommendation: yes, consistency wins.

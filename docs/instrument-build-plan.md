# Build plan — Instrument (Review · Workbench · Verify)

Status: **Complete; current through 2026-07-13.** All phases and the post-launch
Workbench updates shipped to `main`. The detailed implementation sections below
preserve the original build specification; the current-state amendments in this
header supersede any conflicting historical UI copy or behavior.

## Ship log

| PR | Merged | What shipped |
|---|---|---|
| [#25](https://github.com/MattNimmo/servicetimes/pull/25) | 2026-06-28 | Route group shell `(instrument)`, layout, CSS tokens, Glance (full), Workbench + Triage placeholders, InstrumentNav/Tabs, `getGlanceData` + `getTriageBadgeCount` queries, CI ECR retry fix |
| [#26](https://github.com/MattNimmo/servicetimes/pull/26) | 2026-06-28 | WorkbenchView (bento grid, element table, TrendChart, cross-campus tile), TriageView (full service-flow), CorrectModal, Toast, `getWorkbenchData` + `getTriageData` queries, workbench + triage pages wired to real data |
| [#27](https://github.com/MattNimmo/servicetimes/pull/27) | 2026-06-28 | `isHumanAdjusted` wired to `active_item_time_corrections`; element-level trend data (mid/message/worship) using bulk queries instead of N×2 per-plan loop |
| [#28](https://github.com/MattNimmo/servicetimes/pull/28) | 2026-06-28 | Phase 2 taxonomy grooming: `map_item_to_element` RPC + migration, `mapItemToElementAction` server action, `availableElements[]` in `TriageData`, MapActions component replaces DisabledActions |
| [#29](https://github.com/MattNimmo/servicetimes/pull/29) | 2026-06-28 | Phase 3 Glance recommendations: rules-based `buildRecommendations` engine (5 rules, no new queries), mid-service lever row, `recWindow` state consumed |
| [#31](https://github.com/MattNimmo/servicetimes/pull/31) | 2026-07-12 | Workbench mobile table affordance; Close Worship comparison removed; selected-weekend Mid comparison across locations added and wired to the existing service toggle |

## Current-state amendments

- The product name is **Emmanuel Service Times**. The Emmanuel icon set is used
  for browser and Apple touch icons; the Planning Center API User-Agent remains
  `ECC Service Times v2` as a stable integration identifier.
- User-facing terminology is **Location** and **Verify**. Internal identifiers
  and route compatibility remain `campus` and `/instrument/triage`.
- The visible latest-Sunday surface is **Review**. Its existing
  `/instrument/glance` route, `GlanceView` component, and internal data names
  remain stable for compatibility. The former plan-preview mode, generic
  over/on-plan pill, and user-facing "lever" language were removed. Guidance
  now tells viewers to open cards for details.
- The shared sticky navigation exposes **At a glance**, **Review**, and
  **Workbench** from both viewer route groups; operators also see **Verify**.
- Public leadership deltas are consistently **vs plan**. Reference targets are
  available only as operator calibration context in Workbench.
- Workbench's service toggle controls both the selected location detail and the
  same-weekend Mid comparison. The first-service cohort pairs Lakeville 10am
  with SLP, ELK, and MG 9am; the 11am cohort remains same-slot and therefore has
  no Lakeville value. Missing data renders `—`.
- The Workbench element table intentionally scrolls horizontally on narrow
  screens. An overflow-aware swipe hint and right-edge fade expose the hidden
  Variance and Actual columns, while the Element column remains sticky.
- Shared viewer/operator passwords have a 6-character code minimum and must
  differ; the session secret remains 32+ characters. Longer production values
  and Vercel rate limiting remain recommended.

## Notable implementation deltas vs. original spec

- **`TriageData`**: spec had `availableSlots` + `unmappedItems: UnmappedItem[]`; shipped with `availableElements: AvailableElement[]` (added in PR #28 for taxonomy grooming). Rollup/unmapped items handled inline in the service flow via `TriageItem.status`, not a separate list.
- **`TrendPoint`**: extended with `midActualSeconds`, `midPlannedSeconds`, `messageActualSeconds`, `messagePlannedSeconds`, `worshipActualSeconds`, `worshipPlannedSeconds` beyond the original spec — required to wire element-level trend toggle.
- **`GlanceRecommendation`**: not in original spec — added as part of Phase 3. Rules-based from `GlanceCampus` data; pattern-window extension point is wired but uses current-week data only.

Design handoff at `~/Desktop/design_handoff_service_times/`. Prototype lives at `Service Times.dc.html` — open in a browser to see intended look, layout, and interaction. README there is self-sufficient; this plan adds the codebase-specific implementation decisions and integration details.

---

## Resolved design tensions

Five tensions between the handoff and the current codebase were reviewed and resolved before this plan was written. Do not relitigate them.

**1. Client components are required.** The handoff is fully interactive (card expand/collapse, segmented toggles, SVG chart metric toggle, modal, toast, nav badge). Build each surface as a server page that fetches typed data, then passes it as props into a single top-level `"use client"` component. The existing viewer convention ("no client components") applied to the simple `/variance` read-only pages; it does not apply here.

**2. Porcelain glass is a distinct visual layer.** The instrument lives at `/instrument/*` inside a new route group `(instrument)` with its own layout. The existing dark `/variance` and `/operator` pages are **untouched**. No shared global CSS changes. All glass tokens and Sora font are scoped to `src/app/(instrument)/layout.tsx` and `src/app/(instrument)/instrument.css`.

**3. Slot-level incidents in Triage.** Each PlanTime gets a **service-time header row** (a wider row rendered above its item rows) that carries slot-level incident chips and their controls (`Map to slot` / `Exclude`). The per-item row statuses and actions from the handoff spec are unchanged. This fills the gap for `slot_resolution`, `missing_live_bounds`, `zero_live_window`, and `reconciliation_gap` incidents which are PlanTime-scoped, not item-scoped.

**4. Headline total vs. phase bar.** The 42–46px total shows `actual_service_seconds` from `effective_plan_times` (the full PlanTime window). The stacked phase bar sums four tracked phases' element actuals from `element_variance`. These are labeled separately — headline = "TOTAL SERVICE", bar = "TRACKED ELEMENTS" — so they do not need to reconcile. Both values come from existing data; no new precision is invented.

**5. Rehearsal/non-production in Triage.** Auto-excluded PlanTimes are filtered out by `effective_plan_times` (`is_manually_excluded = false`, `effective_slot_id is not null`). They never appear in the Triage flow. No special rendering.

---

## Routes and auth

Route group `(instrument)` shares one layout. URLs:

| URL | Auth | Component |
|---|---|---|
| `/instrument` | viewer | redirect → `/instrument/glance` |
| `/instrument/glance` | viewer | `GlanceView` |
| `/instrument/workbench` | viewer | `WorkbenchView` |
| `/instrument/triage` | operator | `TriageView` |

All pages call `requireRole("viewer")` (or `"operator"` for Triage) at the top using the existing `src/lib/auth/server.ts`. Redirect to `/login` if unauthenticated. For Triage, throw `403` if authenticated as viewer (use `notFound()` since there's no operator-error page yet).

Nav badge on Triage tab = count of unresolved rollup/unmapped/incident items across all campuses at their selected focus service, computed server-side on the glance/workbench pages and passed to `InstrumentNav` as a prop.

---

## CSS and design tokens

Create `src/app/(instrument)/instrument.css`. Import it in `(instrument)/layout.tsx` alongside the Sora font.

```css
/* src/app/(instrument)/instrument.css */

:root {
  /* Porcelain glass page */
  --glass-bg: linear-gradient(160deg, #EEF0F8 0%, #E7E4F2 50%, #EFE9F2 100%);

  /* Glass surface */
  --glass-card: rgba(255,255,255,0.54);
  --glass-blur: 22px;
  --glass-border: rgba(255,255,255,0.7);
  --glass-shadow: 0 10px 30px rgba(50,52,90,0.12), inset 0 1px 0 rgba(255,255,255,0.85);

  /* Type */
  --ink: #1C2030;
  --ink-55: rgba(28,32,48,0.55);

  /* Variance semantics */
  --over: #CF522C;
  --under: #2E9C6B;
  --accent: #2C7E8C;
  --amber-text: #B96A14;
  --amber-fill: #DD8A20;

  /* Campus identity */
  --elk: #4F86C6;
  --lv: #F4A261;
  --mg: #2EC4B6;
  --slp: #E76F51;

  /* Phase fills */
  --phase-worship: #3C4450;
  --phase-mid: #DD8A20;
  --phase-live: #6E7884;
  --phase-local: #99A1AC;

  /* Radius */
  --r-card: 16px;
  --r-glance: 20px;
  --r-triage: 14px;
  --r-modal: 18px;
}
```

**Sora font** — use `next/font/google` in the layout (avoids runtime Google Fonts fetch):

```ts
// src/app/(instrument)/layout.tsx
import { Sora } from "next/font/google";
const sora = Sora({ subsets: ["latin"], weight: ["400","500","600","700"] });
```

Apply `className={sora.className}` to the layout's wrapper div, not `<html>` (which is in root layout). All instrument components inherit it. All numerics get `font-variant-numeric: tabular-nums` via a utility class `tabular` or inline style.

---

## New queries — `src/lib/instrument/queries.ts`

`"server-only"`. Uses existing `readRows`/`postRpc` from `src/lib/supabase/rest.ts`. Import `computeVariance`, `isSlotBlocked`, `isElementBlocked` from `src/lib/variance/queries.ts`.

### Helper types

```ts
export type CampusCode = "SLP" | "MG" | "ELK" | "LV";

export type PhaseKey = "worship_open" | "mid_service" | "live" | "local";

export type PhaseBreakdown = Record<PhaseKey, { plannedSeconds: number; actualSeconds: number | null }>;

export type ServiceSlotSummary = {
  slotId: number;
  slotLabel: string;
  planTimeId: number;
  plannedSeconds: number | null;
  actualSeconds: number | null;          // raw actual_service_seconds
  broadcastStartsAt: string | null;      // live_starts_at
  broadcastEndsAt: string | null;        // live_ends_at
  isBlocked: boolean;                    // any slot-blocking incident
};

export type GlanceCampus = {
  code: CampusCode;
  name: string;
  referenceTargetSeconds: number;        // provisional — always 4500 currently
  serviceDate: string;
  planId: number;
  slots: ServiceSlotSummary[];
  phases: PhaseBreakdown;               // sum across all slots for the date
  openIncidentCount: number;
  unmappedCount: number;
};

export type WorkbenchData = {
  campus: { code: CampusCode; name: string };
  serviceDate: string;
  planId: number;
  slot: ServiceSlotSummary;
  phases: PhaseBreakdown;
  elements: WorkbenchElementRow[];
  trend: TrendPoint[];                   // chronological, most recent last
  allCampusMedians: CrossCampusMedian[]; // for cross tile
  referenceTargetSeconds: number;
};

export type WorkbenchElementRow = {
  elementKey: string;
  elementName: string;
  sectionKey: string;
  sectionName: string;
  sectionSortOrder: number;
  elementSortOrder: number;
  plannedSeconds: number;
  actualSeconds: number | null;
  actualIsComplete: boolean;
  isBlocked: boolean;
  isHumanAdjusted: boolean;             // true if active correction exists for this item
};

export type TrendPoint = {
  serviceDate: string;
  plannedSeconds: number | null;
  actualSeconds: number | null;         // null if needs_review
  isMoment: boolean;                    // true if open incidents on this date
};

export type CrossCampusMedian = {
  campusCode: CampusCode;
  elementKey: string;
  medianSeconds: number | null;
  isActive: boolean;                    // true = the currently selected campus
};

export type TriageData = {
  campus: { code: CampusCode; name: string };
  serviceDate: string;
  planTitle: string;
  slots: TriageSlot[];
  availableSlots: Array<{ id: number; label: string }>;
  unmappedItems: UnmappedItem[];
  totalAttentionCount: number;          // for nav badge
};

export type TriageSlot = {
  planTimeId: number;
  slotLabel: string;
  pcoName: string | null;
  startsAt: string | null;
  slotIncidents: SlotIncident[];        // slot-blocking incidents on this PlanTime
  sections: TriageSection[];
};

export type SlotIncident = {
  id: number;
  kind: string;
  planTimeId: number;
  canCorrectPlanTimeActual: boolean;
  canResolveSlotResolution: boolean;
  rawActualSeconds: number | null;
  plannedSeconds: number | null;
  availableSlots: Array<{ id: number; label: string }>;
};

export type TriageSection = {
  sectionKey: string;
  sectionLabel: string;
  sectionSortOrder: number;
  items: TriageItem[];
};

export type TriageItem = {
  id: number;
  sequence: number;
  rawTitle: string;
  itemType: "song" | "header" | "media" | "item";
  servicePosition: "pre" | "during" | "post" | null;
  sectionKey: string | null;
  elementKey: string | null;
  plannedSeconds: number | null;
  actualSeconds: number | null;
  status: TriageItemStatus;
  incident: TriageItemIncident | null;
};

export type TriageItemStatus =
  | "good"          // mapped + complete + no incident
  | "not_tracked"   // pre/post-service or is_analytics_eligible=false
  | "rollup"        // song that is rollup candidate
  | "unmapped"      // combined title or no element_key
  | "incident"      // open review_incident
  | "resolved";     // resolved this session (client-side only)

export type TriageItemIncident = {
  id: number;
  kind: string;
  canCorrectPlanTimeActual: boolean;
  canCorrectItemTimes: boolean;
  itemTimeId: number | null;
  rawActualSeconds: number | null;
  plannedSeconds: number | null;
};

export type UnmappedItem = {
  id: number;
  planItemId: number;
  rawTitle: string;
  reason: "combined_title" | "rollup_candidate" | "section_mismatch";
  sectionKey: string | null;
  suggestedElementKey: string | null;
};
```

### `getGlanceData(): Promise<GlanceCampus[]>`

For each of the 4 campuses:
1. Read the most recent `plans` row (`campus_id = eq.{campusId}`, `order=service_date.desc`, `limit=1`).
2. Read `effective_plan_times` for that plan (`time_type=eq.service`, `is_manually_excluded=eq.false`, `effective_slot_id=not.is.null`); include `live_starts_at`, `live_ends_at`.
3. Read `service_slots` for campus (`is_active=eq.true`).
4. Read `element_variance` for plan (all rows).
5. Read open `review_incidents` for all plan_time_ids of the plan.
6. Read `unmapped_items` count for campus + service_date.
7. Read `campuses` row to get `reference_target_seconds`.

Build `PhaseBreakdown` by grouping `element_variance` rows by `section_key` and summing `planned_seconds` / `actual_seconds` across all slots, for section_keys `worship_open`, `mid_service`, `live`, `local` only (pre/post are `is_analytics_eligible=false` and never appear in `element_variance`).

Run all 4 campus queries concurrently with `Promise.all`.

### `getWorkbenchData(campusCode: string, slotLabel: string, horizon: "last" | "6wk" | "6mo" | "12mo"): Promise<WorkbenchData | null>`

1. Look up campus by code.
2. Find `service_slots` for campus matching `slotLabel`.
3. Read `plans` ordered `service_date.desc`, limit by horizon:
   - `last` → 1 plan
   - `6wk` → 6 plans
   - `6mo` → 26 plans
   - `12mo` → 52 plans
4. For the **most recent** plan (index 0): full element_variance, slot data, incidents, corrections — same as `getVarianceDashboard` but scoped to the selected slot.
5. For **all plans in horizon**: read `effective_plan_times` filtered to the slot (by `effective_slot_id = eq.{slotId}`), plus open incidents per plan_time for moment detection — build `TrendPoint[]` (one per service_date).
6. For the **cross tile** (`mid.close_worship` median across campuses): fetch `element_variance` filtered to `element_key=eq.mid.close_worship` for the last 6 service dates across all 4 campuses; compute median per campus from `actual_seconds`.
7. `isHumanAdjusted` on each element row: read `active_item_time_corrections` for the plan + slot's items. If any corrected row exists for an item in the element's `item_ids`, mark `isHumanAdjusted=true`.

Note: `active_plan_time_corrections` already exists in `src/lib/variance/queries.ts` — check for a view or table named `active_item_time_corrections`; if not present yet from slice 3 migration, skip the `isHumanAdjusted` flag (default false) and add a TODO comment.

### `getTriageData(campusCode: string, serviceDate: string): Promise<TriageData | null>`

This composes from existing query infrastructure:

1. Look up campus.
2. Read `plans` for campus + service_date.
3. Read ALL `plan_times` for the plan (not just effective ones — Triage shows the operator everything), include `pco_name`, `starts_at`, `live_starts_at`.
4. Read `effective_plan_times` for production slots only (to know which plan_times are mapped).
5. Read `service_slots` for campus (active, non-run-through) for the "Map to slot" dropdown.
6. Read open `review_incidents` with `review_incident_items`.
7. Read ALL `items` for the plan, ordered `sequence.asc`, include `item_type`, `service_position`, `section_key`, `element_key`, `planned_seconds`.
8. Read `item_times` for all production plan_time_ids, include `actual_seconds`.
9. Read `unmapped_items` for campus + service_date.

Classify each item's `TriageItemStatus`:
- `servicePosition === "pre"` or section `pre_service` → `not_tracked`
- `servicePosition === "post"` or section `post_service` → `not_tracked`
- Has an open incident that covers this item → `incident`
- `itemType === "song"` and `element_key === null` and no section mismatch → `rollup`
- `element_key === null` → `unmapped`
- `section_key === null` → `unmapped`
- Otherwise, `actual_seconds !== null` → `good`; else → `good` (planned-only is still good-to-go if no incident)

Group items into `TriageSection[]` using `section_key`. Use section display labels from taxonomy:
```ts
const SECTION_LABELS: Record<string, string> = {
  pre_service: "PRE SERVICE",
  worship_open: "PRAISE & WORSHIP",
  mid_service: "MID SERVICE",
  live: "LIVE TIME",
  local: "LOCATION DISCONNECT",
  post_service: "ONLINE DISCONNECT",
};
const SECTION_ORDER = ["pre_service","worship_open","mid_service","live","local","post_service"];
```

For items with `section_key === null`, group them under an "UNSECTIONED" group at the bottom.

Build `TriageSlot[]` — one per `plan_time` row (all plan_times, not just effective). For each, collect slot-level incidents (those where `plan_time_id === planTime.id` and `kind` is in `SLOT_BLOCKING_KINDS`).

`totalAttentionCount` = count of items across all slots where status is `rollup`, `unmapped`, or `incident`.

---

## New server actions

The four existing actions in `src/lib/operator/review-actions.ts` cover all write paths Triage needs:
- `resolveReviewIncidentAction` — kept / excluded
- `correctPlanTimeIncidentAction` — slot actual correction
- `resolveSlotResolutionIncidentAction` — map to slot / exclude run-through
- `correctItemTimeIncidentAction` — item time correction

Triage calls these via `<form action={...}>` (no new actions needed). The `redirectTo` hidden field should point to `/instrument/triage` so post-action navigation returns to the right page, not `/operator/review`. Update the `safeRedirectPath` guard in `review-actions.ts` to also allow paths starting with `/instrument`.

---

## Component tree

```
src/app/(instrument)/
  layout.tsx                  ← Sora font, glass CSS, InstrumentNav
  instrument.css              ← CSS custom properties (glass tokens)
  instrument/
    page.tsx                  ← redirect("/instrument/glance")
    glance/
      page.tsx                ← server: requireRole("viewer"), getGlanceData() → <GlanceView>
    workbench/
      page.tsx                ← server: requireRole("viewer"), getWorkbenchData() → <WorkbenchView>
      [default searchParams fallback: campusCode="SLP", slotLabel="9am", horizon="last"]
    triage/
      page.tsx                ← server: requireRole("operator"), getTriageData() → <TriageView>
      [default searchParams fallback: campusCode="SLP", serviceDate=most recent]

src/components/instrument/
  InstrumentNav.tsx           ← "use client", 3-tab frosted nav, triage badge
  GlanceView.tsx              ← "use client", full Glance surface
  WorkbenchView.tsx           ← "use client", full Workbench surface
  TriageView.tsx              ← "use client", full Triage surface
  CorrectModal.tsx            ← "use client", frosted overlay with form
  Toast.tsx                   ← "use client", frosted bottom-center pill

src/lib/instrument/
  queries.ts                  ← server-only, all instrument data reads
  types.ts                    ← shared types (re-exported from queries.ts or separate)
```

---

## Layout (`src/app/(instrument)/layout.tsx`)

```tsx
import { Sora } from "next/font/google";
import "./instrument.css";
import { getSession } from "@/lib/auth/server";
import InstrumentNav from "@/components/instrument/InstrumentNav";

const sora = Sora({ subsets: ["latin"], weight: ["400","500","600","700"] });

export default async function InstrumentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const isOperator = session?.role === "operator";

  return (
    <div className={sora.className} style={{ minHeight: "100vh", background: "var(--glass-bg)", color: "var(--ink)", position: "relative" }}>
      {/* Campus color glows — fixed, behind content */}
      <div aria-hidden className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div style={{ position:"absolute", top:"10%", left:"8%",  width:520, height:520, borderRadius:"50%", background:"radial-gradient(circle, #2EC4B6 0%, transparent 70%)", opacity:.28, filter:"blur(85px)" }} />
        <div style={{ position:"absolute", top:"15%", right:"12%", width:520, height:520, borderRadius:"50%", background:"radial-gradient(circle, #4F86C6 0%, transparent 70%)", opacity:.26, filter:"blur(80px)" }} />
        <div style={{ position:"absolute", bottom:"20%", left:"15%", width:520, height:520, borderRadius:"50%", background:"radial-gradient(circle, #E76F51 0%, transparent 70%)", opacity:.30, filter:"blur(88px)" }} />
        <div style={{ position:"absolute", bottom:"15%", right:"8%",  width:520, height:520, borderRadius:"50%", background:"radial-gradient(circle, #F4A261 0%, transparent 70%)", opacity:.34, filter:"blur(90px)" }} />
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        <InstrumentNav isOperator={isOperator} triageBadge={0} {/* badge computed per-page; pass as prop from page */} />
        {children}
      </div>
    </div>
  );
}
```

> Note: the `triageBadge` prop needs to come from each server page. Pass it down by having each page render a wrapper that includes nav state. Simplest approach: server pages render `<InstrumentPageShell triageBadge={n}>…</InstrumentPageShell>` where `InstrumentPageShell` is a thin client wrapper that provides the badge to a context consumed by `InstrumentNav`. Or: skip the badge in the layout, let `InstrumentNav` accept it as an optional prop defaulting to 0, and each page renders its own nav-aware shell. **Recommended:** keep nav in layout, fetch badge in layout by calling `getTriageBadgeCount()` (a lightweight query — counts open incidents + unmapped items across all campuses for the most recent service dates). The badge will be slightly stale relative to session-resolved items (acceptable).

---

## `InstrumentNav` (`src/components/instrument/InstrumentNav.tsx`)

```tsx
"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";

const TABS = [
  { label: "GLANCE",    href: "/instrument/glance" },
  { label: "WORKBENCH", href: "/instrument/workbench" },
  { label: "TRIAGE",    href: "/instrument/triage", operatorOnly: true },
];

export default function InstrumentNav({
  isOperator,
  triageBadge,
}: {
  isOperator: boolean;
  triageBadge: number;
}) {
  const path = usePathname();
  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 50, height: 64,
      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      background: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.7)",
      display: "flex", alignItems: "center", padding: "0 24px", gap: 4,
    }}>
      {/* Logo: gradient "E" chip */}
      <span style={{ marginRight: 20, width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg, #2C7E8C, #4F86C6)", display:"inline-flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:14 }}>E</span>

      {TABS.filter(t => !t.operatorOnly || isOperator).map(tab => {
        const active = path.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} style={{
            position: "relative",
            padding: "6px 14px",
            borderRadius: 999,
            fontSize: 11, fontWeight: 600, letterSpacing: "0.14em",
            color: active ? "var(--ink)" : "var(--ink-55)",
            background: active ? "#fff" : "transparent",
            boxShadow: active ? "0 1px 4px rgba(50,52,90,0.10), 0 0 0 1px rgba(255,255,255,0.8)" : "none",
            transition: "all 0.14s ease",
            textDecoration: "none",
          }}>
            {tab.label}
            {tab.label === "TRIAGE" && triageBadge > 0 && (
              <span style={{ position:"absolute", top:-4, right:-4, minWidth:16, height:16, borderRadius:999, background:"var(--over)", color:"#fff", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px" }}>{triageBadge}</span>
            )}
          </Link>
        );
      })}

      <div style={{ flex: 1 }} />
      {/* Logout form */}
      <form action="/api/auth/logout" method="POST">
        <button type="submit" style={{ fontSize:11, color:"var(--ink-55)", background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Sign out</button>
      </form>
    </nav>
  );
}
```

Add a `/api/auth/logout` route handler that calls `logoutAction` or replicate the cookie-clear logic there. Alternatively, render a `<form action={logoutAction}>` directly (server action in a client component — pass the action as a prop from a server boundary).

---

## `GlanceView` (`src/components/instrument/GlanceView.tsx`)

`"use client"`. Receives `GlanceCampus[]` as props (already fetched, no client-side fetches).

### State
```ts
const [mode, setMode] = useState<"actuals"|"awaiting">("actuals");
const [recWindow, setRecWindow] = useState<6|12>(6);
const [expanded, setExpanded] = useState<Record<string, boolean>>({});
const [glanceSvc, setGlanceSvc] = useState<Record<string, string>>({}); // campusCode → slotLabel
```

### Layout
- Header: eyebrow `THE MONDAY GLANCE`, h1 `Where did each campus land?`, subhead. Two segmented controls top-right: `VIEW` (SUN ACTUALS / THU PLAN) and `PATTERN WINDOW` (6 WK / 12 WK).
- Campus grid: `display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 456px), 1fr)); gap: 18px; padding: 24px`.

### Campus card
Glass card (`background: var(--glass-card)`, `backdropFilter: blur(var(--glass-blur))`, `border: 1px solid var(--glass-border)`, `borderRadius: var(--r-glance)`, `boxShadow: var(--glass-shadow)`). Entire card `onClick` → toggle expand.

**Card header:**
- Campus color dot: 11px rounded square + box-shadow glow in campus color. Campus name (16px/600). Schedule e.g. "9 AM · 11 AM" (9.5px/500 uppercase, 0.14em spacing). Status pill right-aligned.
- Chevron icon (Unicode `▾`/`▸` or Lucide `ChevronDown`/`ChevronRight`).

Status pill logic (single selected service, the `glanceSvc[code]` slot):
- If mode = `"awaiting"` → `AWAITING SUNDAY` (gray)
- Else if `actualSeconds > referenceTargetSeconds` → `OVER TARGET` (coral background)
- Else if `actualSeconds <= referenceTargetSeconds` → `ON TARGET` (green)
- Else → `PLANNED` (gray)

**Big total**: slot `actualSeconds` formatted `M:SS` (42px/700 tabular). Signed delta vs `referenceTargetSeconds` (15px/700, colored per variance semantics). Focus label `9 AM · TOTAL · PROVISIONAL TARGET`.

**Phase stacked bar** (13px tall, `border-radius: 999px`, `overflow:hidden`):
- Four segments in order: Worship / Mid / Live / Local.
- Width proportional to each phase's `plannedSeconds` / total planned.
- At the 80% mark: a hatch overlay div positioned absolutely past the `referenceTargetSeconds`-equivalent tick.
- Ink tick line at `referenceTargetSeconds` position.
- Labels below: `0:00` left, `PROV. TARGET {M:SS}` right.
- Phase legend row: four chips with phase name + actual M:SS. Mid chip and value in `var(--amber-text)`.

**Verdict line** (below legend):
- `actual <= reference` → `✓ Cleared the target` (green)
- `delta <= 60s` over → `Within normal range · slightly over plan` (gray)
- Otherwise → `{N} structural fixes to review` (amber)

N = `openIncidentCount + unmappedCount`.

**Footer toggle**: `▼ TAP FOR N RECOMMENDATIONS · PHASES · LEVER` button.

**Expanded section** (CSS `@keyframes stvIn`: `from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) }`):
- Service selector: pill row of the campus's slots, each with a dot (green if on/under, coral if over) + total time.
- Mid-service lever: amber-tinted row — eyebrow `MID-SERVICE · THE LEVER`, sub-label `the part you actually control`, value from `phases.mid_service.actualSeconds` formatted M:SS, signed delta vs planned.
- Patterns & Recommendations: **currently empty** — render `{/* Recommendations: Phase 3 */}` placeholder div with `RECOMMENDATIONS` eyebrow and greyed `No recommendations yet · Phase 3` message.
- Cross-campus spread footer: show the four campuses' totals in a compact row.

### `formatM` helper
```ts
function formatM(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2,"0")}`;
}
function formatSigned(seconds: number | null): string {
  if (seconds === null) return "—";
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const value = `${m}:${String(s).padStart(2,"0")}`;
  return seconds > 0 ? `+${value}` : seconds < 0 ? `−${value}` : "0:00";
}
```

---

## `WorkbenchView` (`src/components/instrument/WorkbenchView.tsx`)

`"use client"`. Receives `WorkbenchData` as initial prop. **Does not refetch** — campus/slot/horizon changes navigate to the same page with updated searchParams (standard Next.js pattern: `router.push("/instrument/workbench?campus=ELK&slot=9am&horizon=6wk")`). The server page reads searchParams and passes fresh data.

### State
```ts
const [wbMetric, setWbMetric] = useState<"total"|"mid"|"message"|"worship">("total");
```

### Campus selector
Four pills: ELK / MG / LV / SLP. Active = white with campus-colored text + campus color dot. Click triggers `router.push` with updated campus param.

### Context row
Campus name + dot, service toggle (9am/11am/10am per campus), HORIZON toggle (LAST / 6 WK / 6 MO / 12 MO) right-aligned. Each toggle triggers `router.push`.

### Bento grid (`display:grid; grid-template-columns:repeat(4,1fr); gap:14px`)

**Total tile** (span 2): eyebrow `TOTAL SERVICE · {horizon}`, 46px total (`actualSeconds`), signed delta vs `referenceTargetSeconds` with `VS PROV. TARGET · n={trend.length}`, stacked phase bar (same recipe as Glance), phase legend.

**Broadcast Window tile** (span 2): teal eyebrow `BROADCAST WINDOW`, `{broadcastStartsAt formatted 9:27a} → {broadcastEndsAt formatted 10:13a}`, `{duration} MIN LIVE`. A small phase mini-bar with LIVE segment in `var(--accent)` teal, others gray. Caption `live → end · the message block, after mid & before local`.

Format broadcast time: `9:27a` / `12:12p`:
```ts
function formatBroadcastTime(isoOrTime: string | null): string | null {
  if (!isoOrTime) return null;
  // Parse HH:MM from ISO or time string; convert to 12h "9:27a" format
  const date = new Date(isoOrTime);
  const h = date.getHours();
  const m = date.getMinutes();
  const suffix = h >= 12 ? "p" : "a";
  return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2,"0")}${suffix}`;
}
```

**Current Mid comparison tile**: amber-tinted, span-two glass card. The left side
shows the selected location's `phases.mid_service.actualSeconds` and signed delta
vs plan. The right side shows same-weekend Mid actuals for SLP / ELK / LV / MG,
matched by the active service-toggle slot. The active location is outlined and
labeled `Current`; missing plan/slot data renders `—`. At mobile widths the two
halves stack vertically. This replaces the original Close Worship median tile
and its `allCampusMedians` query.

**Variance trend tile** (span 2): eyebrow `VARIANCE · 12 WK`, metric toggle chips (TOT / MID / MSG / WOR). SVG line chart (width:100%, height:120px):
- Zero line at `y=50%`, dashed teal median line.
- Points colored by sign: above zero = `var(--over)`, below = `var(--under)`.
- Moment-flagged week (has open incidents) = hollow circle (`fill:none, stroke:currentColor`).
- Caption `○ moment · — median {value}`.
- Metric toggle maps: `total` → slot `actual_service_seconds`, `mid` → `phases.mid_service.actualSeconds`, `message` → element `live.message`, `worship` → element `worship.open`.

For non-`total` metrics, Workbench needs element-level trend data too. **Simplification:** for MVP, only `total` metric is wired to real data; `mid`, `message`, `worship` render with a `data not yet available` sub-label. Add a TODO comment.

**Element table panel** (below bento):
`display:grid; grid-template-columns: 184px 60px 1fr 100px`. Header: `ELEMENT | ALLOT | [bar] | ACTUAL · Δ`.

On narrow screens the table remains horizontally scrollable rather than
compressing the variance visualization. The card header shows `Swipe for
variance & actual →` only while overflow exists and the table is at its left
edge; a right-edge fade reinforces the affordance. The Element column is sticky
during horizontal scrolling.

Group by section. Section header row: section name uppercase + subtotal row "allot M:SS · actual M:SS".

Each element row:
- Element name. If `isHumanAdjusted`, append `ADJ` chip (teal outline, 5px radius).
- Allotted time: `plannedSeconds` formatted M:SS.
- Diverging bar (SVG or CSS): centered on plan midpoint. Coral segment grows right when over, green segment grows left when under. Thin 1px ink vertical line at center (the plan line). Width ∝ `|deltaSeconds| / planned * barWidth`. No median tick (removed by request).
- "actual M:SS + signed Δ" right column. If `isBlocked` → render `NEEDS REVIEW` amber pill instead.

Row hover: `background: rgba(255,255,255,0.35)`.

---

## `TriageView` (`src/components/instrument/TriageView.tsx`)

`"use client"`. Receives `TriageData` as prop. Campus/service changes navigate via router.push. Campus selector and service toggle trigger navigation.

### State
```ts
const [flowResolved, setFlowResolved] = useState<Set<string>>(new Set()); // "{planTimeId}::{itemId}"
const [toast, setToast] = useState<string | null>(null);
const [modal, setModal] = useState<CorrectModalPayload | null>(null);
```

`flowResolved` — optimistic UI: after a form submission completes, call `setFlowResolved(prev => new Set([...prev, key]))`. Toast appears on any resolution.

### Header
Eyebrow `TRIAGE · SERVICE FLOW`. H1 `Resolve in the flow of the service.` Summary `{N} items need attention, surfaced inline in service order below. {M} good to go.`

Campus selector + plan label (`Spring Lake Park · #4 · Jun 28, 2026`) + 9AM/11AM toggle.

Legend row: four status indicators — `✓ Good to go` (green) · `ROLL-UP?` (amber) · `UNMAPPED` (amber) · `INCIDENT` (coral) · `NOT TRACKED` (gray).

### Service order panel
Glass panel, full width, `borderRadius: var(--r-triage)`.

Column header row: `{slotLabel} | LEN | TITLE | STATUS · ACTION` (grid `74px 52px 1fr auto`, padding `10px 18px`).

For each `TriageSlot`:

1. **Service-time header row** (new, not in prototype — resolved tension #3):
   - Full-width row with background `rgba(28,32,48,0.06)`, left border `3px solid` in the slot's incident color (coral if slot-blocking incident, gray otherwise).
   - Left: slot label bold + PlanTime `pco_name` (if differs from slot label).
   - Right: `slotIncidents` rendered as chips with their action buttons inline — no modal needed for kept/excluded, but `Map to slot` opens a `<select>` of `availableSlots`, and `Correct` opens the `CorrectModal`.
   - If no slot incidents, show a subtle green `✓` and `NO SLOT ISSUES`.

2. **Section header rows** (uppercase, 0.16em): section label + right-aligned count chip: `ALL CLEAR` (green) or `{N} NEED ATTENTION` (amber).

3. **Item rows**:
   - Grid `74px 52px 1fr auto`.
   - Col 1: cumulative start time (compute by summing `plannedSeconds` of all preceding items from service start). Service start = `slot.startsAt` parsed to local time; pre-service items have negative offsets from `00:00:00`.
   - Col 2: `item.plannedSeconds` formatted M:SS (or `—` if null).
   - Col 3: `item.rawTitle`. Sub-note: element name if `elementKey` is set and differs from title, shown below in `var(--ink-55)` at 11px.
   - Col 4: status chip + action.

Status/action per `TriageItemStatus`:

| Status | Left border | Tint | Chip | Action |
|---|---|---|---|---|
| `good` | none | none | `✓ MAPPED` green + delta if actual | none |
| `not_tracked` | none | none | `NOT TRACKED` gray | none |
| `rollup` | 3px amber | amber `rgba(185,106,20,0.06)` | `ROLL-UP?` amber | **Roll up** button + **Keep separate** button |
| `unmapped` | 3px amber | amber | `UNMAPPED · {reason}` amber | **Map to canonical…** `<select>` + **Split**/**Create** buttons |
| `incident` | 3px coral | coral `rgba(207,82,44,0.06)` | `{KIND}` e.g. `RECONCILIATION GAP` coral + delta | **Correct** (→ modal) / **Keep** / **Exclude** |
| `resolved` | none | none | `✓ RESOLVED` green | none |

`{reason}` for unmapped: `"COMBINED TITLE"` / `"ROLLUP CANDIDATE"` / `"SECTION MISMATCH"`.

For `rollup` and `unmapped` items, the action buttons submit to a placeholder `resolveUnmappedAction` (stub for now — taxonomy resolution is Phase 2 taxonomy grooming, not yet wired). Show the buttons disabled with a `coming soon` title attribute. Add a TODO comment.

For `incident` items:
- **Keep** → `<form action={resolveReviewIncidentAction}><input name="resolution" value="kept" /><input name="incidentId" value={incident.id} /><input name="redirectTo" value="/instrument/triage" /></form>`
- **Exclude** → same form, `value="excluded"`
- **Correct** → `setModal({ incidentId, kind, rawActual, planned, itemTimeId })` → opens `CorrectModal`

On form submission (these are server actions that redirect), the optimistic state (`flowResolved`) won't persist across the redirect. This is acceptable — the revalidated page will show the item as resolved from the DB. For a smoother UX, wrap each form in a `useOptimistic` hook to flip the row to `resolved` immediately. Optional enhancement.

---

## `CorrectModal` (`src/components/instrument/CorrectModal.tsx`)

`"use client"`. Props: `{ payload: CorrectModalPayload | null; onClose: () => void }`.

```ts
type CorrectModalPayload = {
  incidentId: number;
  kind: string;
  rawActualSeconds: number | null;
  plannedSeconds: number | null;
  itemTimeId: number | null;  // null = plan_time correction; non-null = item_time correction
};
```

Overlay: `position:fixed; inset:0; background:rgba(40,42,80,0.32); backdropFilter:blur(5px); zIndex:100`. Click-outside closes (`onClick` on overlay, `stopPropagation` on panel).

Panel: glass card `borderRadius:var(--r-modal)`, max-width 420px, centered. Title `Correct actual`. `RAW ACTUAL {M:SS}` vs `PLAN {M:SS}` in a two-column info row.

Input: `Corrected M:SS` text field (pattern `\d+:\d{2}`). Reason field (optional textarea, placeholder `What changed?`).

Submit button: `SAVE · HUMAN-ADJUSTED` in accent teal.

Form action: if `itemTimeId !== null` → `correctItemTimeIncidentAction` with `itemTime:{itemTimeId}={value}` field; else → `correctPlanTimeIncidentAction` with `correctedActual={value}`.

---

## `Toast` (`src/components/instrument/Toast.tsx`)

`"use client"`. Props: `{ message: string | null; onDismiss: () => void }`.

Fixed bottom-center. Glass pill: `backdropFilter:blur(20px)`, `background:rgba(255,255,255,0.72)`, `borderRadius:999px`, `boxShadow: var(--glass-shadow)`. `✓ {message}` + DISMISS button. Auto-dismiss after 4s via `useEffect`. Animate in/out with `@keyframes slideUp`.

---

## Server page patterns

All three pages follow this pattern:

```tsx
// src/app/(instrument)/instrument/glance/page.tsx
import { requireRole } from "@/lib/auth/server";
import { getGlanceData } from "@/lib/instrument/queries";
import GlanceView from "@/components/instrument/GlanceView";

export default async function GlancePage() {
  await requireRole("viewer");
  const campuses = await getGlanceData();
  return <GlanceView campuses={campuses} />;
}
```

For Workbench/Triage that accept selection via URL:

```tsx
// src/app/(instrument)/instrument/workbench/page.tsx
export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<{ campus?: string; slot?: string; horizon?: string }>;
}) {
  await requireRole("viewer");
  const { campus = "SLP", slot = "9am", horizon = "last" } = await searchParams;
  const data = await getWorkbenchData(campus, slot, horizon as WorkbenchHorizon);
  if (!data) notFound();
  return <WorkbenchView data={data} />;
}
```

> Remember: Next.js 16 — `searchParams` is a **Promise**, must be awaited.

---

## Files to create

```
src/app/(instrument)/layout.tsx
src/app/(instrument)/instrument.css
src/app/(instrument)/instrument/page.tsx         ← redirect
src/app/(instrument)/instrument/glance/page.tsx
src/app/(instrument)/instrument/workbench/page.tsx
src/app/(instrument)/instrument/triage/page.tsx
src/components/instrument/InstrumentNav.tsx
src/components/instrument/GlanceView.tsx
src/components/instrument/WorkbenchView.tsx
src/components/instrument/TriageView.tsx
src/components/instrument/CorrectModal.tsx
src/components/instrument/Toast.tsx
src/lib/instrument/queries.ts
```

## Files to edit

```
src/lib/operator/review-actions.ts      ← add /instrument to safeRedirectPath allowlist
src/app/page.tsx                        ← add link to /instrument/glance
```

---

## Verification checklist

All items verified as of 2026-06-28.

1. ✅ **Type-check**: `npm run typecheck` passes with zero errors.
2. ✅ **Auth gates**: unauthenticated → `/login`; viewer on `/instrument/triage` → `notFound()`; operator on all three → works.
3. ✅ **Glance**: all 4 campuses render; slot pills, expand toggle, mid-service lever, recommendations panel all render. `provisional target` label in place; no value presented as approved. Phase 3 "All clear" or recommendation rows appear correctly by campus.
4. ✅ **Workbench**: campus + horizon selector navigates; bento grid renders; element table groups by section; diverging bars centered on plan (no median tick); metric toggle (total/mid/message/worship) renders live delta sparklines; `ADJ` chip appears on elements with active corrections.
5. ✅ **Triage**: service order in `sequence.asc`; section headers; slot-level incident chips in service-time header rows; item-level Correct/Keep/Exclude; rollup/unmapped items show live Map dropdown with grouped elements; modal opens/closes (ESC + click-outside); form submits to server actions, page reloads with DB state.
6. ✅ **Toast**: fires on any Triage resolution; dismisses after 4s.
7. ✅ **Nav badge**: operator sees count badge on TRIAGE tab; viewer sees two tabs only.
8. ✅ **Provisional target**: label reads "provisional target" — not "approved" or "reference".
9. ✅ **Needs-review pill**: slots/elements with open incidents show `NEEDS REVIEW` amber pill; null actuals render `—` not `0:00`.
10. ✅ **Taxonomy grooming**: mapping a rollup/unmapped item writes `item_bucket_overrides`, item re-appears as `✓ MAPPED` on reload, drops from Glance badge count.
11. ✅ **Element trend**: bulk queries (5 total) replace N×2 per-plan loop; 12mo horizon loads without query storm.
10. `npm run lint` passes.

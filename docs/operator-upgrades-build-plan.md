# Build Plan — Cron Fix + Operator Capability Upgrades (Triage)

**Status:** ✅ **Implemented (2026-06-28)** — all three parts shipped: Part 1 cron observability + schedule/DST doc (`edc3b59`), Part 2 Triage Sunday navigation (`dab9beb`), Part 3 full reversibility / reopen incident + unmap element (`fdd6495`). This doc is now a historical record; no open work.
**Audience:** Implementing engineer (self-contained — no prior session context needed)
**Repo:** `servicetimes` (Next.js 16 App Router + Supabase, deployed on Vercel)

---

## Context / Why

Three problems in the operator experience:

1. **The weekly PCO ingest cron isn't pulling.** Most-recent `plans.pulled_at` is **2026-06-24** (a manual/dev run, service date 2026-06-21). No cron-driven pull has ever landed; this past Sunday (2026-06-28) never came in. The route silently returns `503` when misconfigured, so failures are invisible.
2. **An operator can't move between Sundays.** `getTriageData(campus, serviceDate)` already accepts any date and `listServiceDates()` already exists — but there's no UI to pick a Sunday, so historical review requires hand-editing the URL.
3. **No way to undo an incorrect fix.** None of the five operator write-actions are reversible from the UI. The data model supports reversal (`correction_sets.status` allows `reverted`, `item_bucket_overrides.revoked_at`, `plan_time_slot_resolutions.superseded_at`, `review_incidents` allows reopening), but no RPCs expose it.

**Outcome:** cron reliably pulls each Sunday (and failures are visible), the operator can navigate to any past Sunday on Triage, and any Triage fix can be undone.

**Scope decisions (locked):** cron = *just get it running* (no date-backfill feature); override = *full reversibility*; date navigation = *Triage only*.

---

## Part 1 — Cron: get it running — ✅ shipped (`edc3b59`)

The cron **code is correct** (`vercel.json` = `0 20 * * 0`; `route.ts` + `runRecurringPcoIngestion` work). The failure is **production config**.

### 1.1 Operator/ops checklist (no code — verify on Vercel)
In **Vercel → Project → Settings → Environment Variables (Production)** confirm:
- `ENABLE_PCO_INGESTION_WRITES = "true"` — kill switch; default off → route returns 503 (`route.ts:23`)
- `CRON_SECRET` set, **≥ 16 chars** — else 503 (`route.ts:16`)
- `PCO_CLIENT_ID`, `PCO_CLIENT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` present
- **Crons run only on Production deployments.** Confirm a prod deploy happened *after* `vercel.json` gained the cron block. Check **Deployments → Crons** for the last `0 20 * * 0` invocation and its HTTP status.

**DST note (document, do not "fix"):** Vercel cron is UTC-only. `20:00 UTC` = **2 PM CST (winter) / 3 PM CDT (summer)**. It fires at 3 PM Central until early November, then 2 PM. A single fixed-UTC cron cannot hold 2 PM wall-clock year-round.

### 1.2 Code change — observability
**File:** `src/app/api/pco/ingest/route.ts`
Add a log line on each short-circuit branch and on success/throw, so a misconfigured run is visible in Vercel function logs (currently the only trace a run leaves is a non-2xx status).

```ts
const secret = process.env.CRON_SECRET;
if (!secret || secret.length < 16) {
  console.error("[pco-ingest] aborted: CRON_SECRET missing or < 16 chars");
  return Response.json({ ok: false, error: "Cron authentication is not configured" }, { status: 503 });
}
if (!authorized(request, secret)) {
  console.warn("[pco-ingest] aborted: unauthorized request (bearer token mismatch)");
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
if (process.env.ENABLE_PCO_INGESTION_WRITES !== "true") {
  console.error('[pco-ingest] aborted: ENABLE_PCO_INGESTION_WRITES is not "true"');
  return Response.json({ ok: false, error: "Database ingestion is disabled" }, { status: 503 });
}
try {
  const result = await runRecurringPcoIngestion();
  console.info(`[pco-ingest] complete: ok=${result.ok} writesPerformed=${result.writesPerformed ?? 0}`);
  return Response.json(result, { status: result.ok ? 200 : 502 });
} catch (error) {
  console.error("[pco-ingest] threw:", error instanceof Error ? error.message : "unknown");
  return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown recurring ingestion error" }, { status: 502 });
}
```

### 1.3 Doc fix
**File:** `README.md` — it says "Monday at 14:00 UTC". Correct to **"Sunday 20:00 UTC"** (`vercel.json` is source of truth).

### 1.4 Recover this Sunday (no code)
After prod env is confirmed, pull today's data via the **existing** path:
- CLI: `npm run ingest -- --campus SLP --commit --verify` (repeat for `MG`, `ELK`, `LV`), **or**
- `curl -X POST https://<prod-host>/api/pco/ingest -H "Authorization: Bearer $CRON_SECRET"`

Both pull "latest completed," so they grab June 28 **only if** PCO has it marked recorded with live bounds. If not yet completed in PCO, that's a data-entry timing issue, not a bug.

---

## Part 2 — Sunday navigation on Triage — ✅ shipped (`dab9beb`)

Backend already supports arbitrary dates. This is thin wiring + UI.

### 2.1 Expose the date list to the instrument module
**Reuse** `listServiceDates(code)` in `src/lib/variance/queries.ts:204` — returns every plan for a campus with `service_date`, `title`, `series_title`, `openIncidentCount`, `unmappedCount`.
- Either re-export it from `src/lib/instrument/queries.ts`, or add a thin wrapper `listInstrumentServiceDates(code)` there that calls it, so the instrument page doesn't import from the variance module directly. Export a typed shape:
  ```ts
  export type ServiceDateOption = {
    serviceDate: string;          // plan.service_date
    title: string | null;
    attentionCount: number;       // openIncidentCount + unmappedCount
  };
  ```

### 2.2 Wire into the Triage page
**File:** `src/app/(instrument)/instrument/triage/page.tsx` (already reads `?campus` + `?date`)
- After `getTriageData(...)`, also call the date-list function for `campus`.
- Pass the list to `TriageView` as a new prop `availableDates: ServiceDateOption[]`. The currently-selected date is already `data.serviceDate`.

### 2.3 Triage UI
**File:** `src/components/instrument/TriageView.tsx`
- Add `availableDates` to the component props.
- Render a **date selector** beside the campus buttons:
  - A `<select>` of Sundays (option label = `formatServiceDate(serviceDate)` + a small "•N" badge when `attentionCount > 0`), defaulting to `data.serviceDate`.
  - **‹ Prev / Next ›** buttons stepping through the sorted `availableDates` (dates are newest-first from the query; Prev = older, Next = newer — keep direction intuitive in the UI).
  - On change: `router.push(\`/instrument/triage?campus=${campus}&date=${serviceDate}\`)`.
- **Fix the campus selector** (`TriageView.tsx:596`, currently hard-codes `&date=latest`): preserve the current date when switching campus:
  ```ts
  router.push(`/instrument/triage?campus=${newCampus}&date=${data.serviceDate}`);
  ```
  If the new campus has no plan on that exact date, `getTriageData` returns `null` and the page `notFound()`s. Handle gracefully: in the page, if `getTriageData(campus, date)` is null **and** `date !== "latest"`, retry with `"latest"` (so switching campus never dead-ends). Add a brief inline note when this fallback happens (optional).

---

## Part 3 — Full reversibility ("override" an incorrect fix) — ✅ shipped (`fdd6495`)

### 3.1 New migration
**File:** `supabase/migrations/20260628120000_operator_reversibility.sql` (any timestamp later than `20260628000000`)
Mirror `supabase/migrations/20260628000000_map_item_to_element.sql` exactly: `security definer`, `set search_path = ''`, input validation with errcode `22023`, `admin_audit_log` write, `revoke all` from `public, anon, authenticated`, `grant execute` to `service_role`.

```sql
-- Operator reversibility: undo a resolved/corrected incident, and unmap an element override.

-- 1) Unified "undo this fix" for a resolved incident.
create function public.reopen_review_incident(
  p_incident_id bigint,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.review_incidents%rowtype;
  v_before jsonb;
begin
  if p_incident_id is null or p_incident_id <= 0 then
    raise exception 'p_incident_id is required' using errcode = '22023';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'p_actor is required' using errcode = '22023';
  end if;

  select * into v_incident
    from public.review_incidents
    where id = p_incident_id
    for update;
  if not found then
    raise exception 'review incident % not found', p_incident_id using errcode = 'P0002';
  end if;
  if v_incident.status = 'open' then
    raise exception 'review incident % is already open', p_incident_id using errcode = '22023';
  end if;

  v_before := to_jsonb(v_incident);

  -- Roll back correction side-effects when the incident was corrected.
  if v_incident.status = 'corrected' then
    update public.correction_sets
      set status = 'reverted'
      where incident_id = p_incident_id and status = 'active';

    if v_incident.plan_time_id is not null then
      update public.plan_time_slot_resolutions
        set superseded_at = now()
        where plan_time_id = v_incident.plan_time_id and superseded_at is null;
    end if;
  end if;

  update public.review_incidents
    set status = 'open', resolved_at = null, resolved_by = null
    where id = p_incident_id;

  insert into public.admin_audit_log (actor, action, entity_type, entity_id, before_state, after_state)
  values (
    p_actor, 'review_incident.reopened', 'review_incident', p_incident_id::text,
    v_before,
    jsonb_build_object('incident_id', p_incident_id, 'status', 'open', 'reverted_from', v_incident.status)
  );

  return jsonb_build_object('ok', true, 'incident_id', p_incident_id, 'status', 'open', 'reverted_from', v_incident.status);
end;
$$;

revoke all on function public.reopen_review_incident(bigint, text) from public, anon, authenticated;
grant execute on function public.reopen_review_incident(bigint, text) to service_role;

-- 2) Unmap: revoke the active item->element override, reverting to the ingested element_key.
create function public.revoke_item_element_mapping(
  p_item_id bigint,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id bigint;
  v_before jsonb;
begin
  if p_item_id is null or p_item_id <= 0 then
    raise exception 'p_item_id is required' using errcode = '22023';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'p_actor is required' using errcode = '22023';
  end if;

  select id, to_jsonb(ibo) into v_existing_id, v_before
    from public.item_bucket_overrides ibo
    where item_id = p_item_id and revoked_at is null
    for update;

  if not found then
    return jsonb_build_object('ok', true, 'item_id', p_item_id, 'revoked', false);
  end if;

  update public.item_bucket_overrides set revoked_at = now() where id = v_existing_id;

  insert into public.admin_audit_log (actor, action, entity_type, entity_id, before_state, after_state)
  values (
    p_actor, 'item.mapping_revoked', 'item_bucket_override', p_item_id::text,
    v_before,
    jsonb_build_object('item_id', p_item_id, 'override_id', v_existing_id, 'revoked', true)
  );

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'override_id', v_existing_id, 'revoked', true);
end;
$$;

revoke all on function public.revoke_item_element_mapping(bigint, text) from public, anon, authenticated;
grant execute on function public.revoke_item_element_mapping(bigint, text) to service_role;
```

**Notes for the implementer:**
- Confirm the actual column names against `supabase/migrations/20260623193000_initial_service_times.sql` (`review_incidents`, `correction_sets`, `plan_time_slot_resolutions`) and the status-domain extension in `20260624020000_atomic_pco_ingestion.sql`. Adjust `resolved_by` / `resolved_at` column names if they differ.
- Reopening a `corrected` slot-resolution leaves the `plan_time` with **no active resolution** — which is exactly the pre-resolution state (the open `slot_resolution` incident reappears). That's intended.
- After revert, the `correction_sets_one_active_revision` unique slot is freed, so the existing `correct_*` RPCs can apply a fresh correction without constraint violation.

### 3.2 Server actions
**File:** `src/lib/operator/review-actions.ts` — follow the existing pattern (`requireRole("operator")`, `safeRedirectPath`, `postRpc`, `revalidatePath` for `/operator/review` + `/instrument` + `/variance`, then `redirect`).

```ts
export async function reopenReviewIncidentAction(formData: FormData) {
  const session = await requireRole("operator");
  const incidentId = Number(formData.get("incidentId"));
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));
  if (!Number.isInteger(incidentId) || incidentId <= 0) throw new Error("Invalid review incident.");

  await postRpc<{ ok: boolean; incident_id: number; status: string }>("reopen_review_incident", {
    p_incident_id: incidentId,
    p_actor: session.role,
  });

  revalidatePath("/operator/review");
  revalidatePath("/instrument");
  revalidatePath("/variance");
  redirect(redirectTo);
}

export async function unmapItemAction(formData: FormData) {
  const session = await requireRole("operator");
  const itemId = Number(formData.get("itemId"));
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));
  if (!Number.isInteger(itemId) || itemId <= 0) throw new Error("Invalid item.");

  await postRpc<{ ok: boolean; item_id: number; revoked: boolean }>("revoke_item_element_mapping", {
    p_item_id: itemId,
    p_actor: session.role,
  });

  revalidatePath("/operator/review");
  revalidatePath("/instrument");
  revalidatePath("/variance");
  redirect(redirectTo);
}
```

### 3.3 Surface resolved/overridden state in Triage
**File:** `src/lib/instrument/queries.ts`, `getTriageData`
Today `openTriageIncidents` fetches only `status='open'`, so a resolved item disappears and can't be undone. Extend:

1. **Resolved/corrected incidents:** fetch incidents with `status in (kept,excluded,corrected)` for the plan's `plan_time`s (a sibling query to `openTriageIncidents`). Render their items as `status: "resolved"` (already in `TriageItemStatus` + `STATUS_CONFIG`), carrying:
   - the incident `id` (for the Undo button),
   - the resolution kind label (`KEPT` / `EXCLUDED` / `CORRECTED`).
   Add fields to `TriageItem` (or its incident sub-object) to hold `resolvedIncidentId` + `resolutionLabel`. Do **not** add these to `totalAttentionCount`.
2. **Active overrides:** fetch `item_bucket_overrides` for the plan's item ids where `revoked_at is null`. Flag matching items with `hasOverride: true` on `TriageItem` so the UI can show **Unmap**. (Overridden items otherwise render as `good`.)

Ordering caveat: an item could match both an open incident and a resolved one; prioritize `open` (attention) over `resolved` in the status decision, matching the existing precedence in the classifier.

### 3.4 Triage UI
**File:** `src/components/instrument/TriageView.tsx`
- On `resolved` rows: a small, quiet **"Undo fix"** button → `<form action={reopenReviewIncidentAction}>` with hidden `incidentId` + `redirectTo`. One control regardless of resolution type — the RPC dispatches.
- On items flagged `hasOverride`: an **"Unmap"** button → `<form action={unmapItemAction}>` with hidden `itemId` + `redirectTo`. It sits alongside the existing `MapActions` (which stays for `unmapped` items).
- Keep both visually low-emphasis (recovery affordances, not attention items). `resolved` is already excluded from "NEED ATTENTION" counts.

---

## Operator capability review (gaps → resolution)

| Capability | Today | After |
|---|---|---|
| Pull each Sunday automatically | Broken (prod config) | Running + observable |
| Pull a specific/missed Sunday | No (latest-only) | Out of scope — recover via existing CLI |
| Navigate to a past Sunday | URL-edit only | Date picker + prev/next (Triage) |
| Preserve date when switching campus | No (resets to latest) | Preserved |
| Undo element mapping | Remap-only | `revoke_item_element_mapping` + Unmap |
| Reopen kept/excluded incident | **Impossible** | `reopen_review_incident` + Undo |
| Revert plan/item time correction | **Impossible** | Folded into `reopen_review_incident` |
| Revert slot resolution | **Impossible** | Folded into `reopen_review_incident` |

Out of scope (acceptable): Glance/Workbench date nav; `admin_audit_log` reason field; date-parameterized ingest/backfill.

---

## Verification

1. **Migration:** apply locally (`supabase db reset` or push). Exercise both RPCs via psql/`postRpc`:
   - Resolve→`corrected` an incident, run `reopen_review_incident` → status flips to `open`, the active `correction_sets` row is `reverted`, and any active `plan_time_slot_resolutions` for that `plan_time` is superseded. Then a fresh `correct_*` succeeds (constraint freed).
   - Resolve→`kept`/`excluded`, run `reopen_review_incident` → status `open`, `resolved_at/by` cleared.
   - Map an item, run `revoke_item_element_mapping` → override `revoked_at` set; `element_variance` reverts to original `element_key`. Calling again on an unmapped item returns `{revoked:false}` without error.
   - Confirm `admin_audit_log` rows for `review_incident.reopened` and `item.mapping_revoked`.
2. **Typecheck + lint:** `npx tsc --noEmit` and `npm run lint` clean.
3. **Triage E2E (manual; needs `service_role` Supabase data — run `npm run dev` in this project):**
   - `/instrument/triage?campus=SLP` → date picker jumps to a past Sunday and back; Prev/Next steps through Sundays.
   - Switch campus → selected date is preserved (or falls back to latest if that campus lacks the date).
   - Map an item, then **Unmap** → returns to its original chip.
   - Resolve/correct an incident → shows as `resolved`; **Undo fix** → returns to `open` and is actionable again.
4. **Cron:** after prod env confirmed, `POST /api/pco/ingest` with the bearer secret → `{ok:true, writesPerformed:4}`; re-query `plans.pulled_at` for a fresh timestamp + June 28.

---

## Commits (separate; commit on `main` then `git push origin main`)

1. `fix(cron): observability logging + correct schedule doc` — Part 1.2 + 1.3
2. `feat(triage): navigate between service dates` — Part 2
3. `feat(operator): reversible fixes — reopen incident + unmap element` — Part 3 (migration + actions + queries + UI)

**Guardrails:** never amend; never `git add raw/`; keep filenames lowercase-hyphenated; never skip git hooks.

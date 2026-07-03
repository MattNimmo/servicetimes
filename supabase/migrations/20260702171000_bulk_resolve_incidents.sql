-- Bulk incident resolution (docs/backfill-ingestion-build-plan.md Phase 4).
-- Accept-as-is ("kept") every open incident of one non-slot-blocking kind
-- older than a cutoff date, in one audited call. Historical timer noise from
-- a backfill is not worth correcting one service at a time.

create function public.bulk_resolve_review_incidents(
  p_kind text,
  p_before_date date,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_count integer := 0;
begin
  if nullif(trim(p_actor), '') is null then
    raise exception 'p_actor is required'
      using errcode = '22023';
  end if;

  -- Slot-blocking kinds (slot_resolution, missing_live_bounds,
  -- zero_live_window, reconciliation_gap) gate data integrity and must be
  -- resolved individually.
  if p_kind not in ('zero_allotment', 'timer_bleed', 'missing_item_end', 'bundle_overlap') then
    raise exception 'kind % cannot be bulk-resolved', p_kind
      using errcode = '22023';
  end if;

  if p_before_date is null then
    raise exception 'p_before_date is required'
      using errcode = '22023';
  end if;

  update public.review_incidents ri
  set status = 'kept',
      resolved_at = now(),
      resolved_by = trim(p_actor)
  from public.plan_times pt
  join public.plans p on p.id = pt.plan_id
  where ri.plan_time_id = pt.id
    and ri.status = 'open'
    and ri.kind = p_kind
    and p.service_date < p_before_date;

  get diagnostics resolved_count = row_count;

  insert into public.admin_audit_log (actor, action, entity_type, entity_id, before_state, after_state)
  values (
    trim(p_actor),
    'review_incident.bulk_kept',
    'review_incident',
    p_kind,
    jsonb_build_object('kind', p_kind, 'before_date', p_before_date),
    jsonb_build_object('resolved_count', resolved_count)
  );

  return jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'before_date', p_before_date,
    'resolved_count', resolved_count
  );
end;
$$;

revoke all on function public.bulk_resolve_review_incidents(text, date, text)
  from public, anon, authenticated;
grant execute on function public.bulk_resolve_review_incidents(text, date, text)
  to service_role;

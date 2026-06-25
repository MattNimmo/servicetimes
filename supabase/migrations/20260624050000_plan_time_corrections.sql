-- Phase 2B (slice 1): slot actual corrections for PlanTime-scoped incidents.

create view public.active_plan_time_corrections
with (security_invoker = true)
as
select distinct on (cv.plan_time_id)
  cv.plan_time_id,
  cv.corrected_planned_seconds,
  cv.corrected_actual_seconds,
  cs.id as correction_set_id,
  cs.incident_id,
  cs.created_at
from public.correction_values cv
join public.correction_sets cs on cs.id = cv.correction_set_id
where cv.plan_time_id is not null
  and cs.status = 'active'
order by cv.plan_time_id, cs.created_at desc, cs.id desc;

create function public.correct_plan_time_incident(
  p_incident_id bigint,
  p_corrected_actual_seconds integer,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_record public.review_incidents%rowtype;
  after_record public.review_incidents%rowtype;
  next_revision integer;
  new_correction_set_id bigint;
begin
  if p_corrected_actual_seconds < 0 then
    raise exception 'corrected actual seconds must be non-negative'
      using errcode = '22023';
  end if;

  if nullif(trim(p_actor), '') is null then
    raise exception 'actor is required'
      using errcode = '22023';
  end if;

  select *
    into before_record
    from public.review_incidents
    where id = p_incident_id
    for update;

  if not found then
    raise exception 'review incident % was not found', p_incident_id
      using errcode = 'P0002';
  end if;

  if before_record.status <> 'open' then
    raise exception 'review incident % is already %', p_incident_id, before_record.status
      using errcode = '23514';
  end if;

  if before_record.plan_time_id is null then
    raise exception 'review incident % does not target a PlanTime', p_incident_id
      using errcode = '23514';
  end if;

  if before_record.kind not in ('missing_live_bounds', 'zero_live_window', 'reconciliation_gap') then
    raise exception 'review incident % does not support plan time correction', p_incident_id
      using errcode = '23514';
  end if;

  select coalesce(max(cs.revision), 0) + 1
    into next_revision
    from public.correction_sets cs
    where cs.incident_id = p_incident_id;

  insert into public.correction_sets (
    incident_id,
    revision,
    created_by
  )
  values (
    p_incident_id,
    next_revision,
    p_actor
  )
  returning id into new_correction_set_id;

  insert into public.correction_values (
    correction_set_id,
    plan_time_id,
    corrected_actual_seconds
  )
  values (
    new_correction_set_id,
    before_record.plan_time_id,
    p_corrected_actual_seconds
  );

  update public.review_incidents
    set status = 'corrected',
        resolved_at = now(),
        resolved_by = p_actor
    where id = p_incident_id
    returning * into after_record;

  insert into public.admin_audit_log (
    actor,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  )
  values (
    p_actor,
    'review_incident.corrected',
    'review_incident',
    p_incident_id::text,
    jsonb_build_object(
      'incident', to_jsonb(before_record)
    ),
    jsonb_build_object(
      'incident', to_jsonb(after_record),
      'correction_set_id', new_correction_set_id,
      'corrected_actual_seconds', p_corrected_actual_seconds
    )
  );

  return jsonb_build_object(
    'ok', true,
    'incident_id', after_record.id,
    'correction_set_id', new_correction_set_id,
    'status', after_record.status
  );
end;
$$;

revoke all on table public.active_plan_time_corrections from anon, authenticated;
grant select on table public.active_plan_time_corrections to service_role;
revoke all on function public.correct_plan_time_incident(bigint, integer, text)
  from public, anon, authenticated;
grant execute on function public.correct_plan_time_incident(bigint, integer, text)
  to service_role;

-- Phase 2B (slice 4): auto-exclude rehearsal PlanTimes from production variance.

create or replace function public.is_non_production_plan_time(
  p_time_type text,
  p_pco_name text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(p_time_type = 'rehearsal', false)
    or coalesce(p_pco_name ilike '%rehearsal%', false);
$$;

create or replace view public.effective_plan_times
with (security_invoker = true)
as
select
  pt.*,
  case
    when public.is_non_production_plan_time(pt.time_type, pt.pco_name) then null
    when r.action = 'exclude' then null
    when r.action = 'map' then r.slot_id
    else pt.detected_slot_id
  end as effective_slot_id,
  coalesce(r.action = 'exclude', false) as is_manually_excluded
from public.plan_times pt
left join public.plan_time_slot_resolutions r
  on r.plan_time_id = pt.id and r.superseded_at is null;

create or replace function public.resolve_slot_resolution_incident(
  p_incident_id bigint,
  p_action text,
  p_slot_id bigint,
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
  current_resolution public.plan_time_slot_resolutions%rowtype;
  next_revision integer;
  new_resolution_id bigint;
  is_non_production boolean;
begin
  if p_action not in ('map', 'exclude') then
    raise exception 'unsupported slot resolution action: %', p_action
      using errcode = '22023';
  end if;

  if nullif(trim(p_actor), '') is null then
    raise exception 'actor is required'
      using errcode = '22023';
  end if;

  if p_action = 'map' and p_slot_id is null then
    raise exception 'slot id is required when mapping a slot resolution incident'
      using errcode = '22023';
  end if;

  if p_action = 'exclude' and p_slot_id is not null then
    raise exception 'slot id must be null when excluding a slot resolution incident'
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

  if before_record.kind <> 'slot_resolution' then
    raise exception 'review incident % is not a slot resolution incident', p_incident_id
      using errcode = '23514';
  end if;

  if before_record.plan_time_id is null then
    raise exception 'slot resolution incident % does not target a PlanTime', p_incident_id
      using errcode = '23514';
  end if;

  select public.is_non_production_plan_time(pt.time_type, pt.pco_name)
    into is_non_production
    from public.plan_times pt
    where pt.id = before_record.plan_time_id;

  if p_action = 'map' and coalesce(is_non_production, false) then
    raise exception 'non-production PlanTimes cannot be mapped to production slots'
      using errcode = '23514';
  end if;

  select *
    into current_resolution
    from public.plan_time_slot_resolutions
    where plan_time_id = before_record.plan_time_id
      and superseded_at is null
    for update;

  if found then
    update public.plan_time_slot_resolutions
      set superseded_at = now()
      where id = current_resolution.id;
  end if;

  select coalesce(max(revision), 0) + 1
    into next_revision
    from public.plan_time_slot_resolutions
    where plan_time_id = before_record.plan_time_id;

  insert into public.plan_time_slot_resolutions (
    plan_time_id,
    revision,
    action,
    slot_id,
    created_by
  )
  values (
    before_record.plan_time_id,
    next_revision,
    p_action,
    p_slot_id,
    p_actor
  )
  returning id into new_resolution_id;

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
      'incident', to_jsonb(before_record),
      'active_resolution', case
        when current_resolution.id is null then null
        else to_jsonb(current_resolution)
      end
    ),
    jsonb_build_object(
      'incident', to_jsonb(after_record),
      'resolution_id', new_resolution_id,
      'resolution_action', p_action,
      'slot_id', p_slot_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'incident_id', after_record.id,
    'resolution_id', new_resolution_id,
    'status', after_record.status
  );
end;
$$;

revoke all on function public.is_non_production_plan_time(text, text)
  from public, anon, authenticated;

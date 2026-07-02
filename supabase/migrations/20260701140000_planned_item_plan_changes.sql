-- Phase 3 correction: recommendations use the service plan's own item timing
-- as the target for that campus/location/service, not a campus-wide reference.

drop function if exists public.generate_reference_plan_changes(text, date, text, integer);

create function public.generate_planned_item_plan_changes(
  p_campus_code text,
  p_service_date date,
  p_actor text,
  p_min_element_delta_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_campus public.campuses%rowtype;
  target_plan public.plans%rowtype;
  inserted_count integer := 0;
begin
  if nullif(trim(p_actor), '') is null then
    raise exception 'actor is required'
      using errcode = '22023';
  end if;

  if p_min_element_delta_seconds is null or p_min_element_delta_seconds < 0 then
    raise exception 'minimum element delta must be non-negative'
      using errcode = '22023';
  end if;

  select *
    into target_campus
  from public.campuses
  where code = upper(p_campus_code);

  if not found then
    raise exception 'unknown campus %', p_campus_code
      using errcode = 'P0002';
  end if;

  select *
    into target_plan
  from public.plans
  where campus_id = target_campus.id
    and service_date = p_service_date
  order by sort_date desc
  limit 1;

  if not found then
    raise exception 'no plan found for campus % on %', target_campus.code, p_service_date
      using errcode = 'P0002';
  end if;

  with candidate_changes as (
    select
      target_campus.id as campus_id,
      ev.effective_slot_id as slot_id,
      ev.element_key,
      ev.actual_seconds::integer as from_seconds,
      ev.planned_seconds::integer as to_seconds,
      jsonb_build_object(
        'target_source', 'planned_item_seconds',
        'plan_id', target_plan.id,
        'plan_time_id', ev.plan_time_id,
        'service_date', target_plan.service_date,
        'campus_code', target_campus.code,
        'slot_label', ev.slot_label,
        'element_actual_seconds', ev.actual_seconds,
        'element_planned_seconds', ev.planned_seconds,
        'element_delta_seconds', ev.actual_seconds - ev.planned_seconds,
        'generated_by', 'generate_planned_item_plan_changes'
      ) as evidence
    from public.element_variance ev
    join public.elements el
      on el.key = ev.element_key
    where ev.plan_id = target_plan.id
      and ev.effective_slot_id is not null
      and ev.actual_is_complete = true
      and ev.actual_seconds is not null
      and ev.planned_seconds is not null
      and ev.actual_seconds > ev.planned_seconds
      and ev.actual_seconds - ev.planned_seconds >= p_min_element_delta_seconds
      and el.is_lever_eligible = true
  )
  insert into public.plan_changes (
    campus_id,
    slot_id,
    element_key,
    from_seconds,
    to_seconds,
    source,
    status,
    evidence,
    approved_by
  )
  select
    c.campus_id,
    c.slot_id,
    c.element_key,
    c.from_seconds,
    c.to_seconds,
    'recommendation',
    'open',
    c.evidence,
    trim(p_actor)
  from candidate_changes c
  where not exists (
    select 1
    from public.plan_changes existing
    where existing.campus_id = c.campus_id
      and existing.slot_id = c.slot_id
      and existing.element_key = c.element_key
      and existing.status = 'open'
  );

  get diagnostics inserted_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'campus', target_campus.code,
    'service_date', target_plan.service_date,
    'plan_id', target_plan.id,
    'inserted_count', inserted_count
  );
end;
$$;

comment on function public.generate_planned_item_plan_changes(text, date, text, integer) is
  'Creates open recommendation plan_changes for lever-eligible elements whose actual duration exceeded the service plan item target.';

revoke all on function public.generate_planned_item_plan_changes(text, date, text, integer)
  from public, anon, authenticated;
grant execute on function public.generate_planned_item_plan_changes(text, date, text, integer)
  to service_role;

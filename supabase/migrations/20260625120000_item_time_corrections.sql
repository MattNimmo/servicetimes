-- Phase 2B (slice 3): item-time actual corrections for element-level incidents.

create view public.active_item_time_corrections
with (security_invoker = true)
as
select distinct on (cv.item_time_id)
  cv.item_time_id,
  cv.corrected_actual_seconds,
  cs.id as correction_set_id,
  cs.incident_id,
  cs.created_at
from public.correction_values cv
join public.correction_sets cs on cs.id = cv.correction_set_id
where cv.item_time_id is not null
  and cs.status = 'active'
order by cv.item_time_id, cs.created_at desc, cs.id desc;

create or replace view public.element_variance
with (security_invoker = true)
as
select
  p.id as plan_id,
  ept.id as plan_time_id,
  p.campus_id,
  p.service_date,
  ept.effective_slot_id,
  s.slot_label,
  coalesce(ibo.element_key, i.element_key) as element_key,
  el.section_key,
  sec.display_name as section_name,
  sec.sort_order as section_sort_order,
  el.display_name as element_name,
  el.sort_order as element_sort_order,
  array_agg(i.id order by i.sequence) as item_ids,
  sum(i.planned_seconds) as planned_seconds,
  sum(coalesce(aitc.corrected_actual_seconds, it.actual_seconds)) as actual_seconds,
  bool_and(it.id is not null and coalesce(aitc.corrected_actual_seconds, it.actual_seconds) is not null) as actual_is_complete
from public.effective_plan_times ept
join public.plans p on p.id = ept.plan_id
join public.service_slots s on s.id = ept.effective_slot_id
join public.items i on i.plan_id = p.id
left join public.item_bucket_overrides ibo
  on ibo.item_id = i.id and ibo.revoked_at is null
join public.elements el on el.key = coalesce(ibo.element_key, i.element_key)
join public.sections sec on sec.key = el.section_key
left join public.item_times it
  on it.item_id = i.id and it.plan_time_id = ept.id
left join public.active_item_time_corrections aitc
  on aitc.item_time_id = it.id
where ept.is_manually_excluded = false
  and ept.effective_slot_id is not null
  and ept.time_type = 'service'
  and i.is_rollup_child = false
  and coalesce(ibo.element_key, i.element_key) is not null
  and coalesce(it.pco_exclude, false) = false
  and sec.is_analytics_eligible = true
  and el.is_tracked = true
  and i.seen_in_last_pull = true
group by
  p.id,
  ept.id,
  p.campus_id,
  p.service_date,
  ept.effective_slot_id,
  s.slot_label,
  coalesce(ibo.element_key, i.element_key),
  el.section_key,
  sec.display_name,
  sec.sort_order,
  el.display_name,
  el.sort_order;

create function public.correct_item_time_incident(
  p_incident_id bigint,
  p_corrections jsonb,
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
  correction_entry jsonb;
  corrected_item_time_id bigint;
  corrected_actual_seconds integer;
begin
  if jsonb_typeof(p_corrections) <> 'array' or jsonb_array_length(p_corrections) = 0 then
    raise exception 'corrections must be a non-empty JSON array'
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

  if before_record.kind not in ('missing_item_end', 'bundle_overlap') then
    raise exception 'review incident % does not support item time correction', p_incident_id
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

  for correction_entry in
    select * from jsonb_array_elements(p_corrections)
  loop
    corrected_item_time_id := (correction_entry->>'item_time_id')::bigint;
    corrected_actual_seconds := (correction_entry->>'corrected_actual_seconds')::integer;

    if corrected_item_time_id is null or corrected_actual_seconds is null then
      raise exception 'each correction must include item_time_id and corrected_actual_seconds'
        using errcode = '22023';
    end if;

    if corrected_actual_seconds < 0 then
      raise exception 'corrected actual seconds must be non-negative'
        using errcode = '22023';
    end if;

    insert into public.correction_values (
      correction_set_id,
      item_time_id,
      corrected_actual_seconds
    )
    values (
      new_correction_set_id,
      corrected_item_time_id,
      corrected_actual_seconds
    );
  end loop;

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
      'corrections', p_corrections
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

revoke all on table public.active_item_time_corrections from anon, authenticated;
revoke all on table public.element_variance from anon, authenticated;
grant select on table public.active_item_time_corrections to service_role;
grant select on table public.element_variance to service_role;
revoke all on function public.correct_item_time_incident(bigint, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.correct_item_time_incident(bigint, jsonb, text)
  to service_role;

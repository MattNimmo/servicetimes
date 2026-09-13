-- Separate stable service identity from its date-effective display time.
-- Elk River's second service moved from 11:00 to 10:30 on 2026-08-30.

create extension if not exists btree_gist with schema extensions;

alter table public.service_slots
  add column slot_key text;

update public.service_slots s
set slot_key = case
  when s.slot_label in ('9am', '10am') then 'first'
  when s.slot_label = '11am' then 'second'
  else null
end;

do $$
begin
  if exists (
    select 1
    from public.service_slots
    where slot_key is null
  ) then
    raise exception 'Every existing service slot must be assigned a stable slot_key';
  end if;

  if not exists (
    select 1
    from public.service_slots s
    join public.campuses c on c.id = s.campus_id
    where c.code = 'ELK'
      and s.slot_label = '11am'
      and s.slot_key = 'second'
  ) then
    raise exception 'The existing Elk River second-service slot was not found';
  end if;
end;
$$;

alter table public.service_slots
  alter column slot_key set not null,
  add constraint service_slots_slot_key_check
    check (slot_key in ('first', 'second')),
  add constraint service_slots_campus_slot_key_key unique (campus_id, slot_key);

create table public.service_slot_schedules (
  id bigint primary key generated always as identity,
  slot_id bigint not null references public.service_slots(id),
  effective_during daterange not null,
  display_label text not null check (length(trim(display_label)) > 0),
  expected_local_start time not null,
  match_tolerance_minutes integer not null default 10
    check (match_tolerance_minutes between 0 and 60),
  created_at timestamptz not null default now(),
  created_by text,
  unique (slot_id, effective_during),
  exclude using gist (slot_id with =, effective_during with &&)
);

alter table public.service_slot_schedules enable row level security;

insert into public.service_slot_schedules (
  slot_id,
  effective_during,
  display_label,
  expected_local_start,
  match_tolerance_minutes,
  created_by
)
select
  s.id,
  daterange(null, null, '[)'),
  s.slot_label,
  s.expected_local_start,
  s.match_tolerance_minutes,
  'migration:20260913090000_service_slot_schedule_identity'
from public.service_slots s
join public.campuses c on c.id = s.campus_id
where not (c.code = 'ELK' and s.slot_key = 'second');

insert into public.service_slot_schedules (
  slot_id,
  effective_during,
  display_label,
  expected_local_start,
  match_tolerance_minutes,
  created_by
)
select
  s.id,
  schedule.effective_during,
  schedule.display_label,
  schedule.expected_local_start,
  10,
  'migration:20260913090000_service_slot_schedule_identity'
from public.service_slots s
join public.campuses c on c.id = s.campus_id
cross join (
  values
    (daterange(null, '2026-08-30', '[)'), '11am'::text, '11:00'::time),
    (daterange('2026-08-30', null, '[)'), '10:30am'::text, '10:30'::time)
) as schedule(effective_during, display_label, expected_local_start)
where c.code = 'ELK' and s.slot_key = 'second';

create view public.service_slot_schedule_ranges
with (security_invoker = true)
as
select
  s.id,
  s.campus_id,
  s.slot_key,
  s.is_active,
  s.is_run_through,
  ss.id as schedule_id,
  lower(ss.effective_during) as effective_from,
  upper(ss.effective_during) as effective_until,
  ss.display_label as slot_label,
  ss.expected_local_start,
  ss.match_tolerance_minutes
from public.service_slots s
join public.service_slot_schedules ss on ss.slot_id = s.id;

revoke all on table public.service_slot_schedules from anon, authenticated;
revoke all on table public.service_slot_schedule_ranges from anon, authenticated;
grant select on table public.service_slot_schedules to service_role;
grant select on table public.service_slot_schedule_ranges to service_role;

-- Keep element variance labels historically accurate.
create or replace view public.element_variance
with (security_invoker = true)
as
select
  p.id as plan_id,
  ept.id as plan_time_id,
  p.campus_id,
  p.service_date,
  ept.effective_slot_id,
  sss.display_label as slot_label,
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
join public.service_slot_schedules sss
  on sss.slot_id = s.id and sss.effective_during @> p.service_date
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
  and (i.is_rollup_child = false or ibo.id is not null)
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
  sss.display_label,
  coalesce(ibo.element_key, i.element_key),
  el.section_key,
  sec.display_name,
  sec.sort_order,
  el.display_name,
  el.sort_order;

revoke all on table public.element_variance from anon, authenticated;
grant select on table public.element_variance to service_role;

create or replace view public.backfill_quality
with (security_invoker = true)
as
with item_timer_sums as (
  select
    it.plan_time_id,
    sum(coalesce(aitc.corrected_actual_seconds, it.actual_seconds)) as summed_actual_seconds
  from public.item_times it
  join public.items i on i.id = it.item_id
  left join public.active_item_time_corrections aitc
    on aitc.item_time_id = it.id
  where coalesce(it.pco_exclude, false) = false
    and i.seen_in_last_pull = true
    and i.section_key is distinct from 'pre_service'
  group by it.plan_time_id
),
plan_mapping as (
  select
    i.plan_id,
    sum(coalesce(i.planned_seconds, 0)) filter (
      where coalesce(o.element_key, i.element_key) is not null
    ) as mapped_planned_seconds,
    sum(coalesce(i.planned_seconds, 0)) as total_planned_seconds
  from public.items i
  left join public.item_bucket_overrides o
    on o.item_id = i.id and o.revoked_at is null
  where i.item_type in ('item', 'media', 'song')
    and coalesce(i.planned_seconds, 0) > 0
    and i.is_rollup_child = false
    and coalesce(i.section_key, '') not in ('pre_service', 'post_service')
    and i.seen_in_last_pull = true
  group by i.plan_id
),
variance_complete as (
  select
    ev.plan_time_id,
    bool_and(ev.actual_is_complete) as actuals_complete
  from public.element_variance ev
  group by ev.plan_time_id
)
select
  c.code as campus,
  p.service_date,
  ept.id as plan_time_id,
  sss.display_label as slot_label,
  (ept.live_starts_at is not null and ept.live_ends_at is not null) as has_live_bounds,
  abs(
    coalesce(aptc.corrected_actual_seconds, ept.service_actual_seconds, 0)
    - coalesce(its.summed_actual_seconds, 0)
  ) as reconciliation_gap_seconds,
  round(
    100.0 * coalesce(pm.mapped_planned_seconds, 0) / nullif(pm.total_planned_seconds, 0),
    1
  ) as mapped_planned_pct,
  coalesce(vc.actuals_complete, false) as actuals_complete,
  case
    when ept.live_starts_at is not null
     and ept.live_ends_at is not null
     and abs(
       coalesce(aptc.corrected_actual_seconds, ept.service_actual_seconds, 0)
       - coalesce(its.summed_actual_seconds, 0)
     ) <= 60
     and coalesce(
       100.0 * coalesce(pm.mapped_planned_seconds, 0) / nullif(pm.total_planned_seconds, 0),
       0
     ) >= 95
     and coalesce(vc.actuals_complete, false)
      then 'green'
    when ept.live_starts_at is not null
     and ept.live_ends_at is not null
     and abs(
       coalesce(aptc.corrected_actual_seconds, ept.service_actual_seconds, 0)
       - coalesce(its.summed_actual_seconds, 0)
     ) <= 180
     and coalesce(
       100.0 * coalesce(pm.mapped_planned_seconds, 0) / nullif(pm.total_planned_seconds, 0),
       0
     ) >= 85
      then 'yellow'
    else 'red'
  end as grade
from public.effective_plan_times ept
join public.plans p on p.id = ept.plan_id
join public.campuses c on c.id = p.campus_id
join public.service_slots s on s.id = ept.effective_slot_id
join public.service_slot_schedules sss
  on sss.slot_id = s.id and sss.effective_during @> p.service_date
left join public.active_plan_time_corrections aptc
  on aptc.plan_time_id = ept.id
left join item_timer_sums its
  on its.plan_time_id = ept.id
left join plan_mapping pm
  on pm.plan_id = p.id
left join variance_complete vc
  on vc.plan_time_id = ept.id
where ept.time_type = 'service'
  and ept.is_manually_excluded = false
  and ept.effective_slot_id is not null;

revoke all on table public.backfill_quality from anon, authenticated;
grant select on table public.backfill_quality to service_role;

-- One database definition powers recurring-ingest and watchdog completeness.
create view public.ingestion_location_health
with (security_invoker = true)
as
with source_plans as (
  select
    p.id,
    p.campus_id,
    p.service_date,
    p.pco_plan_id
  from public.plans p
)
select
  lp.campus_id,
  lp.service_date,
  lp.id as plan_id,
  lp.pco_plan_id,
  expected.expected_slot_count,
  actual.actual_plan_time_count,
  actual.actual_slot_count,
  coalesce(actual.all_have_live_bounds, false) as all_have_live_bounds,
  coalesce(actual.all_elements_complete, false) as all_elements_complete,
  incidents.blocking_incident_count,
  expected.expected_slot_count > 0
    and actual.actual_plan_time_count = expected.expected_slot_count
    and actual.actual_slot_count = expected.expected_slot_count
    and coalesce(actual.all_have_live_bounds, false)
    and coalesce(actual.all_elements_complete, false)
    and incidents.blocking_incident_count = 0 as is_complete
from source_plans lp
cross join lateral (
  select count(*)::integer as expected_slot_count
  from public.service_slots s
  join public.service_slot_schedules sss
    on sss.slot_id = s.id and sss.effective_during @> lp.service_date
  where s.campus_id = lp.campus_id
    and s.is_active
    and not s.is_run_through
) expected
cross join lateral (
  select
    count(*)::integer as actual_plan_time_count,
    count(distinct ept.effective_slot_id)::integer as actual_slot_count,
    bool_and(ept.live_starts_at is not null and ept.live_ends_at is not null)
      as all_have_live_bounds,
    bool_and(element_state.has_rows and element_state.all_complete)
      as all_elements_complete
  from public.effective_plan_times ept
  cross join lateral (
    select
      count(*) > 0 as has_rows,
      coalesce(bool_and(ev.actual_is_complete), false) as all_complete
    from public.element_variance ev
    where ev.plan_time_id = ept.id
  ) element_state
  where ept.plan_id = lp.id
    and ept.time_type = 'service'
    and not ept.is_manually_excluded
    and ept.effective_slot_id is not null
    and exists (
      select 1
      from public.service_slots s
      join public.service_slot_schedules sss
        on sss.slot_id = s.id and sss.effective_during @> lp.service_date
      where s.id = ept.effective_slot_id
        and s.campus_id = lp.campus_id
        and s.is_active
        and not s.is_run_through
    )
) actual
cross join lateral (
  select count(*)::integer as blocking_incident_count
  from public.review_incidents ri
  where ri.status = 'open'
    and ri.kind in (
      'slot_resolution',
      'missing_live_bounds',
      'zero_live_window',
      'reconciliation_gap'
    )
    and (
      ri.plan_id = lp.id
      or ri.plan_time_id in (
        select pt.id from public.plan_times pt where pt.plan_id = lp.id
      )
    )
) incidents;

revoke all on table public.ingestion_location_health from anon, authenticated;
grant select on table public.ingestion_location_health to service_role;

-- Add stable-key payload support without breaking an older app instance that
-- may still send label-based payloads while this migration rolls out.
alter function public.ingest_pco_plan(jsonb) rename to ingest_pco_plan_legacy;

revoke all on function public.ingest_pco_plan_legacy(jsonb)
  from public, anon, authenticated, service_role;

create function public.ingest_pco_plan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  translated jsonb := payload;
  campus_id bigint;
  entry jsonb;
  entries jsonb := '[]'::jsonb;
  legacy_label text;
begin
  select c.id into campus_id
  from public.campuses c
  where c.code = payload->>'campus';

  if campus_id is null then
    raise exception 'unknown campus code: %', payload->>'campus'
      using errcode = '22023';
  end if;

  for entry in
    select value from jsonb_array_elements(coalesce(payload->'planTimes', '[]'::jsonb))
  loop
    if nullif(entry->>'detectedSlotKey', '') is not null then
      select s.slot_label into legacy_label
      from public.service_slots s
      where s.campus_id = campus_id
        and s.slot_key = entry->>'detectedSlotKey';

      if legacy_label is null then
        raise exception 'unknown slot key % for campus %',
          entry->>'detectedSlotKey', payload->>'campus'
          using errcode = '22023';
      end if;

      entry := entry || jsonb_build_object('detectedSlotLabel', legacy_label);
    end if;
    entries := entries || jsonb_build_array(entry);
  end loop;
  translated := jsonb_set(translated, '{planTimes}', entries, true);

  entries := '[]'::jsonb;
  for entry in
    select value from jsonb_array_elements(coalesce(payload->'incidents', '[]'::jsonb))
  loop
    if nullif(entry->>'slotKey', '') is not null then
      select s.slot_label into legacy_label
      from public.service_slots s
      where s.campus_id = campus_id
        and s.slot_key = entry->>'slotKey';

      if legacy_label is null then
        raise exception 'unknown incident slot key % for campus %',
          entry->>'slotKey', payload->>'campus'
          using errcode = '22023';
      end if;

      entry := entry || jsonb_build_object('slotLabel', legacy_label);
    end if;
    entries := entries || jsonb_build_array(entry);
  end loop;
  translated := jsonb_set(translated, '{incidents}', entries, true);

  return public.ingest_pco_plan_legacy(translated);
end;
$$;

revoke all on function public.ingest_pco_plan(jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_pco_plan(jsonb) to service_role;

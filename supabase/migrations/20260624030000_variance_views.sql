create or replace view public.effective_plan_times
with (security_invoker = true)
as
select
  pt.*,
  case
    when r.action = 'exclude' then null
    when r.action = 'map' then r.slot_id
    else pt.detected_slot_id
  end as effective_slot_id,
  coalesce(r.action = 'exclude', false) as is_manually_excluded
from public.plan_times pt
left join public.plan_time_slot_resolutions r
  on r.plan_time_id = pt.id and r.superseded_at is null;

create view public.element_variance
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
  e.section_key,
  sec.display_name as section_name,
  sec.sort_order as section_sort_order,
  e.display_name as element_name,
  e.sort_order as element_sort_order,
  array_agg(i.id order by i.sequence) as item_ids,
  sum(coalesce(i.planned_seconds, 0))::bigint as planned_seconds,
  sum(it.actual_seconds)::bigint as actual_seconds,
  bool_and(it.id is not null and it.actual_seconds is not null) as actual_is_complete
from public.effective_plan_times ept
join public.plans p on p.id = ept.plan_id
join public.service_slots s on s.id = ept.effective_slot_id
join public.items i on i.plan_id = p.id
left join public.item_bucket_overrides ibo
  on ibo.item_id = i.id and ibo.revoked_at is null
join public.elements e on e.key = coalesce(ibo.element_key, i.element_key)
join public.sections sec on sec.key = e.section_key
left join public.item_times it
  on it.item_id = i.id and it.plan_time_id = ept.id
where ept.is_manually_excluded = false
  and ept.effective_slot_id is not null
  and ept.time_type = 'service'
  and i.is_rollup_child = false
  and i.seen_in_last_pull = true
  and coalesce(it.pco_exclude, false) = false
  and sec.is_analytics_eligible = true
  and e.is_tracked = true
group by
  p.id,
  ept.id,
  p.campus_id,
  p.service_date,
  ept.effective_slot_id,
  s.slot_label,
  coalesce(ibo.element_key, i.element_key),
  e.section_key,
  sec.display_name,
  sec.sort_order,
  e.display_name,
  e.sort_order;

revoke all on table public.element_variance from public, anon, authenticated;
grant select on table public.element_variance to service_role;

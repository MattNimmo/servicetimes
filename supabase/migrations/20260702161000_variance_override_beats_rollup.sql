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
  s.slot_label,
  coalesce(ibo.element_key, i.element_key),
  el.section_key,
  sec.display_name,
  sec.sort_order,
  el.display_name,
  el.sort_order;

revoke all on table public.element_variance from anon, authenticated;
grant select on table public.element_variance to service_role;

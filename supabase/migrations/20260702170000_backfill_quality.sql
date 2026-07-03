-- Backfill quality scorecard (docs/backfill-ingestion-build-plan.md Phase 3).
-- Grades every production plan_time mechanically so backfilled services that
-- pass all checks ("green") are auto-accepted and never need human review.

create view public.backfill_quality
with (security_invoker = true)
as
with item_timer_sums as (
  select
    it.plan_time_id,
    sum(coalesce(aitc.corrected_actual_seconds, it.actual_seconds)) as summed_actual_seconds
  from public.item_times it
  left join public.active_item_time_corrections aitc
    on aitc.item_time_id = it.id
  where coalesce(it.pco_exclude, false) = false
  group by it.plan_time_id
),
plan_mapping as (
  -- Mapped share of planned time, mirroring unmapped_items scope:
  -- during-service timed items, rollup children excluded from both sides.
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
  s.slot_label,
  (ept.live_starts_at is not null and ept.live_ends_at is not null) as has_live_bounds,
  abs(
    coalesce(aptc.corrected_actual_seconds, ept.actual_service_seconds, 0)
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
       coalesce(aptc.corrected_actual_seconds, ept.actual_service_seconds, 0)
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
       coalesce(aptc.corrected_actual_seconds, ept.actual_service_seconds, 0)
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

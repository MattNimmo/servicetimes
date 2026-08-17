-- Total service time begins at the first current, non-pre-service item timer.
-- The raw PlanTime LIVE window remains available as actual_service_seconds for
-- provenance and broadcast-window fallbacks.

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
  coalesce(r.action = 'exclude', false) as is_manually_excluded,
  case
    when pt.live_ends_at is null then null
    when service_window.first_service_start_at is not null then
      greatest(
        0,
        extract(epoch from (
          pt.live_ends_at - service_window.first_service_start_at
        ))::integer
      )
    when service_window.pre_service_timer_count > 0 then 0
    else pt.actual_service_seconds
  end as service_actual_seconds
from public.plan_times pt
left join public.plan_time_slot_resolutions r
  on r.plan_time_id = pt.id and r.superseded_at is null
left join lateral (
  select
    min(it.live_start_at) filter (
      where i.section_key is distinct from 'pre_service'
    ) as first_service_start_at,
    count(*) filter (
      where i.section_key = 'pre_service'
    ) as pre_service_timer_count
  from public.item_times it
  join public.items i on i.id = it.item_id
  where it.plan_time_id = pt.id
    and i.seen_in_last_pull = true
) service_window on true;

comment on column public.effective_plan_times.service_actual_seconds is
  'Countdown-free service length: LIVE end minus the first current item timer not explicitly classified as pre_service; see docs/plan-exclude-countdown-from-service-time.md.';

revoke all on table public.effective_plan_times from anon, authenticated;
grant select on table public.effective_plan_times to service_role;

-- Keep the historical quality scorecard on the same countdown-free arithmetic
-- as ingestion. Item-time corrections and PCO exclusions retain their existing
-- behavior.
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
  s.slot_label,
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

-- Rebase the three production correction overlays that were entered against
-- the countdown-inclusive LIVE window. PlanTimes 24 and 25 are intentionally
-- absent: their existing correction revisions remain byte-for-byte untouched.
do $$
declare
  migration_actor constant text := 'migration:20260817120000_service_window_excludes_countdown';
  target record;
  active_set_id bigint;
  old_set public.correction_sets%rowtype;
  superseded_set public.correction_sets%rowtype;
  old_value public.correction_values%rowtype;
  incident public.review_incidents%rowtype;
  next_revision integer;
  new_set_id bigint;
  new_value_id bigint;
begin
  for target in
    select *
    from (values
      (458::bigint, 5295, 5078),
      (1747::bigint, 5211, 4933),
      (1748::bigint, 5495, 5199)
    ) as targets(
      plan_time_id,
      expected_actual_seconds,
      corrected_actual_seconds
    )
  loop
    select correction_set_id
      into active_set_id
      from public.active_plan_time_corrections
      where plan_time_id = target.plan_time_id
        and corrected_actual_seconds = target.expected_actual_seconds;

    if not found then
      continue;
    end if;

    select *
      into old_set
      from public.correction_sets
      where id = active_set_id
      for update;

    select *
      into old_value
      from public.correction_values
      where correction_set_id = old_set.id
        and plan_time_id = target.plan_time_id;

    select *
      into incident
      from public.review_incidents
      where id = old_set.incident_id
      for update;

    select coalesce(max(revision), 0) + 1
      into next_revision
      from public.correction_sets
      where incident_id = old_set.incident_id;

    update public.correction_sets
      set status = 'superseded',
          status_changed_at = now()
      where id = old_set.id
      returning * into superseded_set;

    insert into public.correction_sets (
      incident_id,
      revision,
      created_by
    )
    values (
      old_set.incident_id,
      next_revision,
      migration_actor
    )
    returning id into new_set_id;

    insert into public.correction_values (
      correction_set_id,
      plan_time_id,
      corrected_actual_seconds
    )
    values (
      new_set_id,
      target.plan_time_id,
      target.corrected_actual_seconds
    )
    returning id into new_value_id;

    insert into public.admin_audit_log (
      actor,
      action,
      entity_type,
      entity_id,
      before_state,
      after_state
    )
    values (
      migration_actor,
      'review_incident.correction_rebased',
      'review_incident',
      old_set.incident_id::text,
      jsonb_build_object(
        'incident', to_jsonb(incident),
        'correction_set', to_jsonb(old_set),
        'correction_value', to_jsonb(old_value)
      ),
      jsonb_build_object(
        'incident', to_jsonb(incident),
        'superseded_correction_set', to_jsonb(superseded_set),
        'correction_set_id', new_set_id,
        'correction_value_id', new_value_id,
        'revision', next_revision,
        'plan_time_id', target.plan_time_id,
        'corrected_actual_seconds', target.corrected_actual_seconds
      )
    );
  end loop;
end
$$;

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_function(
  'public',
  'generate_planned_item_plan_changes',
  array['text', 'date', 'text', 'integer'],
  'planned-item plan-change generator exists'
);

select hasnt_function(
  'public',
  'generate_reference_plan_changes',
  array['text', 'date', 'text', 'integer'],
  'reference-target generator is replaced'
);

select results_eq(
  $$select reference_target_status from public.campuses where code = 'ELK'$$,
  $$values ('provisional'::text)$$,
  'planned-item recommendations do not require approved campus reference targets'
);

insert into public.plans (
  pco_plan_id,
  campus_id,
  service_date,
  sort_date,
  title
)
values (
  'reference-plan',
  (select id from public.campuses where code = 'ELK'),
  '2026-07-05',
  '2026-07-05 14:00:00+00',
  'Reference Plan Fixture'
);

insert into public.plan_times (
  pco_plan_time_id,
  plan_id,
  detected_slot_id,
  slot_resolution_state,
  pco_name,
  time_type,
  starts_at,
  ends_at,
  live_starts_at,
  live_ends_at
)
values (
  'reference-plan-time',
  (select id from public.plans where pco_plan_id = 'reference-plan'),
  (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'ELK') and slot_label = '9am'),
  'auto',
  'First Service',
  'service',
  '2026-07-05 14:00:00+00',
  '2026-07-05 15:15:00+00',
  '2026-07-05 14:00:00+00',
  '2026-07-05 15:17:00+00'
);

insert into public.items (
  pco_item_id,
  plan_id,
  sequence,
  raw_title,
  raw_title_normalized,
  item_type,
  section_key,
  element_key,
  planned_seconds,
  resolution_source
)
values
  (
    'reference-lever-item',
    (select id from public.plans where pco_plan_id = 'reference-plan'),
    1,
    'Close Worship',
    'close worship',
    'item',
    'mid_service',
    'mid.close_worship',
    60,
    'alias'
  ),
  (
    'reference-nonlever-item',
    (select id from public.plans where pco_plan_id = 'reference-plan'),
    2,
    'Message',
    'message',
    'item',
    'live',
    'live.message',
    3600,
    'alias'
  );

insert into public.item_times (
  pco_item_time_id,
  item_id,
  plan_time_id,
  live_start_at,
  live_end_at,
  source_fingerprint
)
values
  (
    'reference-lever-item-time',
    (select id from public.items where pco_item_id = 'reference-lever-item'),
    (select id from public.plan_times where pco_plan_time_id = 'reference-plan-time'),
    '2026-07-05 14:10:00+00',
    '2026-07-05 14:12:10+00',
    'reference-lever-fingerprint'
  ),
  (
    'reference-nonlever-item-time',
    (select id from public.items where pco_item_id = 'reference-nonlever-item'),
    (select id from public.plan_times where pco_plan_time_id = 'reference-plan-time'),
    '2026-07-05 14:15:00+00',
    '2026-07-05 15:17:00+00',
    'reference-nonlever-fingerprint'
  );

select results_eq(
  $$select (public.generate_planned_item_plan_changes('ELK', '2026-07-05', 'operator', 30)->>'inserted_count')::integer$$,
  $$values (1)$$,
  'planned item variance creates one lever-eligible recommendation'
);

select results_eq(
  $$select element_key, from_seconds, to_seconds, source, status from public.plan_changes where campus_id = (select id from public.campuses where code = 'ELK')$$,
  $$values ('mid.close_worship'::text, 130, 60, 'recommendation'::text, 'open'::text)$$,
  'recommendation targets the lever-eligible overage'
);

select results_eq(
  $$select count(*)::bigint from public.plan_changes where element_key = 'live.message'$$,
  $$values (0::bigint)$$,
  'non-lever elements do not get recommendations'
);

select results_eq(
  $$select evidence->>'target_source', evidence->>'element_delta_seconds' from public.plan_changes where element_key = 'mid.close_worship'$$,
  $$values ('planned_item_seconds'::text, '70'::text)$$,
  'recommendation evidence captures the planned item target source and delta'
);

select results_eq(
  $$select (public.generate_planned_item_plan_changes('ELK', '2026-07-05', 'operator', 30)->>'inserted_count')::integer$$,
  $$values (0)$$,
  'open recommendations are not duplicated'
);

select * from finish();
rollback;

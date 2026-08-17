begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select has_column(
  'public',
  'effective_plan_times',
  'service_actual_seconds',
  'effective plan times exposes countdown-free service length'
);

select col_type_is(
  'public',
  'effective_plan_times',
  'service_actual_seconds',
  'integer',
  'countdown-free service length is an integer number of seconds'
);

select ok(
  (
    select col_description(
      'public.effective_plan_times'::regclass,
      ordinal_position
    ) like 'Countdown-free service length:%'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'effective_plan_times'
      and column_name = 'service_actual_seconds'
  ),
  'countdown-free service length documents its domain rule'
);

insert into public.plans (
  pco_plan_id,
  campus_id,
  service_date,
  sort_date,
  title
)
values (
  'service-window-plan',
  (select id from public.campuses where code = 'ELK'),
  '2026-08-16',
  '2026-08-16 14:00:00+00',
  'Service Window Fixture'
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
values
  (
    'service-window-normal',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'ELK') and slot_label = '9am'),
    'auto',
    'Normal',
    'service',
    '2026-08-16 14:00:00+00',
    '2026-08-16 15:15:00+00',
    '2026-08-16 14:00:00+00',
    '2026-08-16 15:00:00+00'
  ),
  (
    'service-window-only-pre',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'ELK') and slot_label = '9am'),
    'auto',
    'Only countdown',
    'service',
    '2026-08-16 16:00:00+00',
    '2026-08-16 16:05:00+00',
    '2026-08-16 16:00:00+00',
    '2026-08-16 16:05:00+00'
  ),
  (
    'service-window-no-timers',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'ELK') and slot_label = '9am'),
    'auto',
    'No item timers',
    'service',
    '2026-08-16 17:00:00+00',
    '2026-08-16 18:15:30+00',
    '2026-08-16 17:00:00+00',
    '2026-08-16 18:15:30+00'
  ),
  (
    'service-window-null-end',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'ELK') and slot_label = '9am'),
    'review',
    'Missing LIVE end',
    'service',
    '2026-08-16 19:00:00+00',
    '2026-08-16 20:15:00+00',
    '2026-08-16 19:00:00+00',
    null
  ),
  (
    'service-window-negative',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'ELK') and slot_label = '9am'),
    'auto',
    'Negative derived window',
    'service',
    '2026-08-16 21:00:00+00',
    '2026-08-16 21:15:00+00',
    '2026-08-16 21:00:00+00',
    '2026-08-16 21:05:00+00'
  ),
  (
    'service-window-unmapped',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'ELK') and slot_label = '9am'),
    'auto',
    'Unmapped first item',
    'service',
    '2026-08-16 22:00:00+00',
    '2026-08-16 23:15:00+00',
    '2026-08-16 22:00:00+00',
    '2026-08-16 23:00:00+00'
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
    'service-window-countdown-item',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    1,
    'Countdown Video',
    'countdown video',
    'media',
    'pre_service',
    'pre.countdown',
    300,
    'alias'
  ),
  (
    'service-window-real-item',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    2,
    'Message',
    'message',
    'item',
    'live',
    'live.message',
    3300,
    'alias'
  ),
  (
    'service-window-unmapped-item',
    (select id from public.plans where pco_plan_id = 'service-window-plan'),
    3,
    'Mystery Moment',
    'mystery moment',
    'item',
    null,
    null,
    120,
    'unmapped'
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
    'service-window-normal-countdown',
    (select id from public.items where pco_item_id = 'service-window-countdown-item'),
    (select id from public.plan_times where pco_plan_time_id = 'service-window-normal'),
    '2026-08-16 14:00:00+00',
    '2026-08-16 14:05:00+00',
    'service-window-normal-countdown-fingerprint'
  ),
  (
    'service-window-normal-real',
    (select id from public.items where pco_item_id = 'service-window-real-item'),
    (select id from public.plan_times where pco_plan_time_id = 'service-window-normal'),
    '2026-08-16 14:05:00+00',
    '2026-08-16 15:00:00+00',
    'service-window-normal-real-fingerprint'
  ),
  (
    'service-window-only-pre-countdown',
    (select id from public.items where pco_item_id = 'service-window-countdown-item'),
    (select id from public.plan_times where pco_plan_time_id = 'service-window-only-pre'),
    '2026-08-16 16:00:00+00',
    '2026-08-16 16:05:00+00',
    'service-window-only-pre-fingerprint'
  ),
  (
    'service-window-null-end-real',
    (select id from public.items where pco_item_id = 'service-window-real-item'),
    (select id from public.plan_times where pco_plan_time_id = 'service-window-null-end'),
    '2026-08-16 19:05:00+00',
    '2026-08-16 20:00:00+00',
    'service-window-null-end-fingerprint'
  ),
  (
    'service-window-negative-real',
    (select id from public.items where pco_item_id = 'service-window-real-item'),
    (select id from public.plan_times where pco_plan_time_id = 'service-window-negative'),
    '2026-08-16 21:06:00+00',
    '2026-08-16 21:10:00+00',
    'service-window-negative-fingerprint'
  ),
  (
    'service-window-unmapped-first',
    (select id from public.items where pco_item_id = 'service-window-unmapped-item'),
    (select id from public.plan_times where pco_plan_time_id = 'service-window-unmapped'),
    '2026-08-16 22:02:00+00',
    '2026-08-16 22:04:00+00',
    'service-window-unmapped-first-fingerprint'
  ),
  (
    'service-window-unmapped-real',
    (select id from public.items where pco_item_id = 'service-window-real-item'),
    (select id from public.plan_times where pco_plan_time_id = 'service-window-unmapped'),
    '2026-08-16 22:05:00+00',
    '2026-08-16 23:00:00+00',
    'service-window-unmapped-real-fingerprint'
  );

select results_eq(
  $$select service_actual_seconds from public.effective_plan_times where pco_plan_time_id = 'service-window-normal'$$,
  $$values (3300)$$,
  'service window starts after the countdown'
);

select results_eq(
  $$select service_actual_seconds from public.effective_plan_times where pco_plan_time_id = 'service-window-only-pre'$$,
  $$values (0)$$,
  'a positive raw LIVE window containing only pre-service timers becomes zero'
);

select results_eq(
  $$select service_actual_seconds from public.effective_plan_times where pco_plan_time_id = 'service-window-no-timers'$$,
  $$values (4530)$$,
  'a PlanTime with no item timers falls back to the raw LIVE window'
);

select results_eq(
  $$select service_actual_seconds from public.effective_plan_times where pco_plan_time_id = 'service-window-null-end'$$,
  $$values (null::integer)$$,
  'a null LIVE end remains null instead of being clamped to zero'
);

select results_eq(
  $$select service_actual_seconds from public.effective_plan_times where pco_plan_time_id = 'service-window-negative'$$,
  $$values (0)$$,
  'a negative derived service window is clamped to zero'
);

select results_eq(
  $$select service_actual_seconds from public.effective_plan_times where pco_plan_time_id = 'service-window-unmapped'$$,
  $$values (3480)$$,
  'an unmapped first item is treated as non-pre-service'
);

select results_eq(
  $$select actual_service_seconds, service_actual_seconds from public.effective_plan_times where pco_plan_time_id = 'service-window-normal'$$,
  $$values (3600, 3300)$$,
  'the raw LIVE window remains available alongside countdown-free service time'
);

select results_eq(
  $$select reconciliation_gap_seconds from public.backfill_quality where plan_time_id = (select id from public.plan_times where pco_plan_time_id = 'service-window-normal')$$,
  $$values (0::bigint)$$,
  'backfill quality excludes the countdown from its timer sum and service window'
);

select * from finish();
rollback;

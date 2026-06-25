begin;

select plan(9);

select has_view(
  'public',
  'active_item_time_corrections',
  'active item time corrections view exists'
);

select has_function(
  'public',
  'correct_item_time_incident',
  array['bigint', 'jsonb', 'text'],
  'item time correction RPC exists'
);

insert into public.plans (
  pco_plan_id,
  campus_id,
  service_date,
  sort_date,
  title
)
values (
  'item-time-correction-plan',
  (select id from public.campuses where code = 'ELK'),
  '2026-07-01',
  '2026-07-01 14:00:00+00',
  'Item Time Correction Fixture'
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
  'item-time-correction-plan-time',
  (select id from public.plans where pco_plan_id = 'item-time-correction-plan'),
  (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'ELK') and slot_label = '9am'),
  'auto',
  'First Service',
  'service',
  '2026-07-01 14:00:00+00',
  '2026-07-01 15:15:00+00',
  '2026-07-01 14:00:00+00',
  '2026-07-01 15:15:00+00'
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
values (
  'item-time-correction-item',
  (select id from public.plans where pco_plan_id = 'item-time-correction-plan'),
  1,
  'Response Song',
  'response song',
  'song',
  'local',
  'local.worship_response',
  300,
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
values (
  'item-time-correction-item-time',
  (select id from public.items where pco_item_id = 'item-time-correction-item'),
  (select id from public.plan_times where pco_plan_time_id = 'item-time-correction-plan-time'),
  '2026-07-01 15:05:00+00',
  '2026-07-01 15:09:00+00',
  'item-time-correction-fingerprint'
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'item-time-correction-plan-time'),
  'missing_item_end',
  'item-time-correction-incident',
  'Fixture item-time correction'
);

insert into public.review_incident_items (
  incident_id,
  item_id,
  item_time_id
)
values (
  (select id from public.review_incidents where source_fingerprint = 'item-time-correction-incident'),
  (select id from public.items where pco_item_id = 'item-time-correction-item'),
  (select id from public.item_times where pco_item_time_id = 'item-time-correction-item-time')
);

select lives_ok(
  $$select public.correct_item_time_incident(
    (select id from public.review_incidents where source_fingerprint = 'item-time-correction-incident'),
    '[{"item_time_id": ' || (select id from public.item_times where pco_item_time_id = 'item-time-correction-item-time') || ', "corrected_actual_seconds": 330}]'::jsonb,
    'operator'
  )$$,
  'an open item-time incident can be corrected'
);

select results_eq(
  $$select status from public.review_incidents where source_fingerprint = 'item-time-correction-incident'$$,
  $$values ('corrected'::text)$$,
  'item-time incidents are marked corrected'
);

select results_eq(
  $$select corrected_actual_seconds from public.active_item_time_corrections where item_time_id = (select id from public.item_times where pco_item_time_id = 'item-time-correction-item-time')$$,
  $$values (330)$$,
  'active item-time corrections expose the corrected actual'
);

select results_eq(
  $$select actual_seconds from public.element_variance where plan_id = (select id from public.plans where pco_plan_id = 'item-time-correction-plan') and element_key = 'local.worship_response'$$,
  $$values (330)$$,
  'element variance reads the corrected item-time actual'
);

select isnt_empty(
  $$select 1 from public.admin_audit_log
    where action = 'review_incident.corrected'
      and entity_type = 'review_incident'
      and after_state->>'correction_set_id' is not null$$,
  'item-time corrections are audited'
);

select throws_ok(
  $$select public.correct_item_time_incident(
    (select id from public.review_incidents where source_fingerprint = 'item-time-correction-incident'),
    '[]'::jsonb,
    'operator'
  )$$,
  '22023',
  null,
  'empty correction arrays are rejected'
);

select * from finish();
rollback;

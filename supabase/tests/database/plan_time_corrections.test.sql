begin;

select plan(10);

select has_view(
  'public',
  'active_plan_time_corrections',
  'active plan time corrections view exists'
);

select has_function(
  'public',
  'correct_plan_time_incident',
  array['bigint', 'integer', 'text'],
  'plan time correction RPC exists'
);

insert into public.plans (
  pco_plan_id,
  campus_id,
  service_date,
  sort_date,
  title
)
values (
  'plan-time-correction-plan',
  (select id from public.campuses where code = 'SLP'),
  '2026-06-29',
  '2026-06-29 15:00:00+00',
  'Plan Time Correction Fixture'
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
  'plan-time-correction-plan-time',
  (select id from public.plans where pco_plan_id = 'plan-time-correction-plan'),
  (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'SLP') limit 1),
  'auto',
  '9am',
  'service',
  '2026-06-29 15:00:00+00',
  '2026-06-29 16:15:00+00',
  null,
  null
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'plan-time-correction-plan-time'),
  'missing_live_bounds',
  'plan-time-correction-incident',
  'Fixture plan time correction'
);

select lives_ok(
  $$select public.correct_plan_time_incident(
    (select id from public.review_incidents where source_fingerprint = 'plan-time-correction-incident'),
    4530,
    'operator'
  )$$,
  'an open plan time incident can be corrected'
);

select results_eq(
  $$select status from public.review_incidents where source_fingerprint = 'plan-time-correction-incident'$$,
  $$values ('corrected'::text)$$,
  'incident status is corrected'
);

select results_eq(
  $$
    select corrected_actual_seconds
    from public.active_plan_time_corrections apc
    join public.plan_times pt on pt.id = apc.plan_time_id
    where pt.pco_plan_time_id = 'plan-time-correction-plan-time'
  $$,
  $$values (4530)$$,
  'the active correction view exposes the corrected actual'
);

select isnt_empty(
  $$select 1 from public.admin_audit_log
    where action = 'review_incident.corrected'
      and entity_type = 'review_incident'
      and after_state->>'correction_set_id' is not null$$,
  'corrections are audited'
);

select throws_ok(
  $$select public.correct_plan_time_incident(
    (select id from public.review_incidents where source_fingerprint = 'plan-time-correction-incident'),
    4400,
    'operator'
  )$$,
  '23514',
  null,
  'a resolved incident cannot be corrected again'
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'plan-time-correction-plan-time'),
  'reconciliation_gap',
  'plan-time-correction-invalid',
  'Fixture invalid correction'
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'plan-time-correction-plan-time'),
  'bundle_overlap',
  'plan-time-correction-unsupported',
  'Fixture unsupported correction'
);

select throws_ok(
  $$select public.correct_plan_time_incident(
    (select id from public.review_incidents where source_fingerprint = 'plan-time-correction-invalid'),
    -1,
    'operator'
  )$$,
  '22023',
  null,
  'corrected actual must be non-negative'
);

select throws_ok(
  $$select public.correct_plan_time_incident(
    (select id from public.review_incidents where source_fingerprint = 'plan-time-correction-invalid'),
    4500,
    ''
  )$$,
  '22023',
  null,
  'actor is required'
);

select throws_ok(
  $$select public.correct_plan_time_incident(
    (select id from public.review_incidents where source_fingerprint = 'plan-time-correction-unsupported'),
    4500,
    'operator'
  )$$,
  '23514',
  null,
  'unsupported incident kinds cannot use the slot correction RPC'
);

select * from finish();
rollback;

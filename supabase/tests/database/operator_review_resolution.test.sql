begin;

select plan(8);

select has_function(
  'public',
  'resolve_review_incident',
  array['bigint', 'text', 'text'],
  'operator review incident resolution RPC exists'
);

insert into public.plans (
  pco_plan_id,
  campus_id,
  service_date,
  sort_date,
  title
)
values (
  'operator-review-plan',
  (select id from public.campuses where code = 'SLP'),
  '2026-06-28',
  '2026-06-28 15:00:00+00',
  'Operator Review Fixture'
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
  'operator-review-plan-time',
  (select id from public.plans where pco_plan_id = 'operator-review-plan'),
  (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'SLP') limit 1),
  'auto',
  '9am',
  'service',
  '2026-06-28 15:00:00+00',
  '2026-06-28 16:15:00+00',
  '2026-06-28 15:00:00+00',
  '2026-06-28 16:15:00+00'
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'operator-review-plan-time'),
  'missing_item_end',
  'operator-review-incident',
  'Operator review fixture'
);

select lives_ok(
  $$select public.resolve_review_incident(
    (select id from public.review_incidents where source_fingerprint = 'operator-review-incident'),
    'kept',
    'operator'
  )$$,
  'an open incident can be marked kept'
);

select results_eq(
  $$select status from public.review_incidents where source_fingerprint = 'operator-review-incident'$$,
  $$values ('kept'::text)$$,
  'incident status is updated'
);

select isnt_empty(
  $$select 1 from public.review_incidents
    where source_fingerprint = 'operator-review-incident'
      and resolved_at is not null
      and resolved_by = 'operator'$$,
  'resolution timestamp and actor are stored'
);

select isnt_empty(
  $$select 1 from public.admin_audit_log
    where action = 'review_incident.kept'
      and entity_type = 'review_incident'
      and before_state->>'status' = 'open'
      and after_state->>'status' = 'kept'$$,
  'resolution writes an audit record'
);

select throws_ok(
  $$select public.resolve_review_incident(
    (select id from public.review_incidents where source_fingerprint = 'operator-review-incident'),
    'excluded',
    'operator'
  )$$,
  '23514',
  null,
  'resolved incidents cannot be resolved again'
);

select throws_ok(
  $$select public.resolve_review_incident(
    (select id from public.review_incidents where source_fingerprint = 'operator-review-incident'),
    'corrected',
    'operator'
  )$$,
  '22023',
  null,
  'only kept or excluded are supported in this slice'
);

select throws_ok(
  $$select public.resolve_review_incident(
    (select id from public.review_incidents where source_fingerprint = 'operator-review-incident'),
    'kept',
    ''
  )$$,
  '22023',
  null,
  'actor is required'
);

select * from finish();
rollback;

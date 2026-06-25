begin;

select plan(10);

select has_function(
  'public',
  'resolve_slot_resolution_incident',
  array['bigint', 'text', 'bigint', 'text'],
  'slot resolution workflow RPC exists'
);

insert into public.plans (
  pco_plan_id,
  campus_id,
  service_date,
  sort_date,
  title
)
values (
  'slot-resolution-plan',
  (select id from public.campuses where code = 'SLP'),
  '2026-06-30',
  '2026-06-30 15:00:00+00',
  'Slot Resolution Fixture'
);

insert into public.plan_times (
  pco_plan_time_id,
  plan_id,
  slot_resolution_state,
  pco_name,
  time_type,
  starts_at,
  ends_at
)
values (
  'slot-resolution-plan-time',
  (select id from public.plans where pco_plan_id = 'slot-resolution-plan'),
  'review',
  'Dress Rehearsal Service',
  'service',
  '2026-06-30 13:00:00+00',
  '2026-06-30 13:50:00+00'
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'slot-resolution-plan-time'),
  'slot_resolution',
  'slot-resolution-map-incident',
  'Fixture slot resolution mapping'
);

select lives_ok(
  $$select public.resolve_slot_resolution_incident(
    (select id from public.review_incidents where source_fingerprint = 'slot-resolution-map-incident'),
    'map',
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'SLP') and slot_label = '9am'),
    'operator'
  )$$,
  'an open slot resolution incident can be mapped to a production slot'
);

select results_eq(
  $$select status from public.review_incidents where source_fingerprint = 'slot-resolution-map-incident'$$,
  $$values ('corrected'::text)$$,
  'mapped slot resolution incidents are marked corrected'
);

select results_eq(
  $$
    select effective_slot_id
    from public.effective_plan_times
    where pco_plan_time_id = 'slot-resolution-plan-time'
  $$,
  $$
    values ((select id from public.service_slots where campus_id = (select id from public.campuses where code = 'SLP') and slot_label = '9am'))
  $$,
  'effective plan times uses the mapped slot'
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'slot-resolution-plan-time'),
  'slot_resolution',
  'slot-resolution-exclude-incident',
  'Fixture slot resolution exclusion'
);

select lives_ok(
  $$select public.resolve_slot_resolution_incident(
    (select id from public.review_incidents where source_fingerprint = 'slot-resolution-exclude-incident'),
    'exclude',
    null,
    'operator'
  )$$,
  'an open slot resolution incident can be excluded from variance'
);

select results_eq(
  $$select is_manually_excluded from public.effective_plan_times where pco_plan_time_id = 'slot-resolution-plan-time'$$,
  $$values (true)$$,
  'effective plan times marks the plan time as manually excluded'
);

select isnt_empty(
  $$select 1 from public.admin_audit_log
    where action = 'review_incident.corrected'
      and entity_type = 'review_incident'
      and after_state->>'resolution_action' = 'exclude'$$,
  'slot resolution workflow writes an audit entry'
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'slot-resolution-plan-time'),
  'bundle_overlap',
  'slot-resolution-wrong-kind',
  'Fixture wrong kind'
);

select throws_ok(
  $$select public.resolve_slot_resolution_incident(
    (select id from public.review_incidents where source_fingerprint = 'slot-resolution-wrong-kind'),
    'map',
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'SLP') and slot_label = '11am'),
    'operator'
  )$$,
  '23514',
  null,
  'only slot resolution incidents may use this workflow'
);

select throws_ok(
  $$select public.resolve_slot_resolution_incident(
    (select id from public.review_incidents where source_fingerprint = 'slot-resolution-wrong-kind'),
    'promote',
    null,
    'operator'
  )$$,
  '22023',
  null,
  'unsupported workflow actions are rejected'
);

select throws_ok(
  $$select public.resolve_slot_resolution_incident(
    (select id from public.review_incidents where source_fingerprint = 'slot-resolution-wrong-kind'),
    'exclude',
    null,
    ''
  )$$,
  '22023',
  null,
  'actor is required'
);

select * from finish();
rollback;

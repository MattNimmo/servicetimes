begin;

select plan(6);

insert into public.plans (
  pco_plan_id,
  campus_id,
  service_date,
  sort_date,
  title
)
values (
  'non-production-plan',
  (select id from public.campuses where code = 'MG'),
  '2026-06-30',
  '2026-06-30 15:00:00+00',
  'Non-production Fixture'
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
  recorded
)
values (
  'non-production-rehearsal-time',
  (select id from public.plans where pco_plan_id = 'non-production-plan'),
  (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'MG') and slot_label = '9am'),
  'review',
  'Dress Rehearsal Service',
  'service',
  '2026-06-30 14:00:00+00',
  '2026-06-30 15:15:00+00',
  true
);

select results_eq(
  $$select effective_slot_id from public.effective_plan_times where pco_plan_time_id = 'non-production-rehearsal-time'$$,
  $$values (null::bigint)$$,
  'rehearsal-named plan times are automatically excluded from production slots'
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
  recorded
)
values (
  'non-production-tech-team-time',
  (select id from public.plans where pco_plan_id = 'non-production-plan'),
  (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'MG') and slot_label = '11am'),
  'review',
  'Tech Team',
  'service',
  '2026-06-30 16:00:00+00',
  '2026-06-30 17:00:00+00',
  true
);

select results_eq(
  $$select effective_slot_id from public.effective_plan_times where pco_plan_time_id = 'non-production-tech-team-time'$$,
  $$values (null::bigint)$$,
  'tech-team plan times are automatically excluded from production slots'
);

insert into public.review_incidents (
  plan_time_id,
  kind,
  source_fingerprint,
  detail
)
values (
  (select id from public.plan_times where pco_plan_time_id = 'non-production-rehearsal-time'),
  'slot_resolution',
  'non-production-slot-resolution',
  'Fixture rehearsal slot resolution'
);

select throws_ok(
  $$select public.resolve_slot_resolution_incident(
    (select id from public.review_incidents where source_fingerprint = 'non-production-slot-resolution'),
    'map',
    (select id from public.service_slots where campus_id = (select id from public.campuses where code = 'MG') and slot_label = '11am'),
    'operator'
  )$$,
  '23514',
  null,
  'rehearsal-named plan times cannot be mapped to production slots'
);

select lives_ok(
  $$select public.resolve_slot_resolution_incident(
    (select id from public.review_incidents where source_fingerprint = 'non-production-slot-resolution'),
    'exclude',
    null,
    'operator'
  )$$,
  'rehearsal-named plan times may still be explicitly excluded'
);

select results_eq(
  $$select status from public.review_incidents where source_fingerprint = 'non-production-slot-resolution'$$,
  $$values ('corrected'::text)$$,
  'excluding the rehearsal incident resolves it'
);

select results_eq(
  $$select is_manually_excluded from public.effective_plan_times where pco_plan_time_id = 'non-production-rehearsal-time'$$,
  $$values (true)$$,
  'manual exclusion state still records on effective plan times'
);

select * from finish();
rollback;

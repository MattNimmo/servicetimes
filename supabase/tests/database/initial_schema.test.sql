begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_table('public', 'campuses', 'campuses exists');
select has_table('public', 'plan_times', 'plan_times exists');
select has_table('public', 'item_times', 'item_times exists');
select has_table('public', 'review_incidents', 'review_incidents exists');
select has_table('public', 'correction_sets', 'correction_sets exists');
select has_table('public', 'correction_values', 'correction_values exists');
select has_view('public', 'unmapped_items', 'unmapped_items view exists');
select has_view('public', 'effective_plan_times', 'effective_plan_times view exists');

select results_eq(
  $$select count(*)::bigint from public.campuses$$,
  $$values (4::bigint)$$,
  'four campuses are seeded'
);

select results_eq(
  $$select count(*)::bigint from public.service_slots where is_active$$,
  $$values (7::bigint)$$,
  'seven production slots are seeded'
);

select results_eq(
  $$select slot_label from public.service_slots s join public.campuses c on c.id = s.campus_id where c.code = 'LV'$$,
  $$values ('10am'::text)$$,
  'Lakeville is a 10am-only campus'
);

select results_eq(
  $$select is_lever_eligible from public.elements where key = 'live.message'$$,
  $$values (false)$$,
  'Message is not lever eligible'
);

select results_eq(
  $$select is_analytics_eligible from public.sections where key = 'pre_service'$$,
  $$values (false)$$,
  'Pre-Service is excluded from analytics'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.plan_times'::regclass),
  'RLS is enabled on plan_times'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.correction_values'::regclass),
  'RLS is enabled on correction_values'
);

select results_eq(
  $$select count(*)::bigint from pg_policies where schemaname = 'public' and tablename = 'plan_times'$$,
  $$values (0::bigint)$$,
  'no browser policy exposes plan_times'
);

select throws_ok(
  $$insert into public.correction_values (correction_set_id, corrected_actual_seconds) values (-1, 60)$$,
  '23514',
  null,
  'a correction must target exactly one occurrence record'
);

insert into public.admin_audit_log
  (actor, action, entity_type, entity_id)
values
  ('test', 'created', 'test', '1');

select throws_ok(
  $$update public.admin_audit_log set action = 'changed' where entity_id = '1'$$,
  'P0001',
  'admin_audit_log is append-only',
  'audit rows cannot be updated'
);

select results_eq(
  $$select is_generated = 'ALWAYS' from information_schema.columns where table_schema = 'public' and table_name = 'plan_times' and column_name = 'actual_service_seconds'$$,
  $$values (true)$$,
  'PlanTime actual duration is generated from raw LIVE bounds'
);

insert into public.plans
  (pco_plan_id, campus_id, service_date, sort_date)
values
  ('test-elk-plan', (select id from public.campuses where code = 'ELK'), '2026-06-21', '2026-06-21 09:00:00-05'),
  ('test-lv-plan', (select id from public.campuses where code = 'LV'), '2026-06-21', '2026-06-21 10:00:00-05');

select throws_ok(
  $$
    insert into public.plan_times
      (pco_plan_time_id, plan_id, detected_slot_id, time_type)
    values (
      'test-cross-campus-time',
      (select id from public.plans where pco_plan_id = 'test-elk-plan'),
      (select s.id from public.service_slots s join public.campuses c on c.id = s.campus_id where c.code = 'LV'),
      'service'
    )
  $$,
  '23514',
  'detected slot must belong to the plan campus',
  'automatic slot detection cannot cross campuses'
);

insert into public.plan_times
  (pco_plan_time_id, plan_id, detected_slot_id, time_type, starts_at, ends_at)
values
  (
    'test-elk-time',
    (select id from public.plans where pco_plan_id = 'test-elk-plan'),
    (select s.id from public.service_slots s join public.campuses c on c.id = s.campus_id where c.code = 'ELK' and s.slot_label = '9am'),
    'service',
    '2026-06-21 09:00:00-05',
    '2026-06-21 10:15:00-05'
  ),
  (
    'test-lv-time',
    (select id from public.plans where pco_plan_id = 'test-lv-plan'),
    (select s.id from public.service_slots s join public.campuses c on c.id = s.campus_id where c.code = 'LV'),
    'service',
    '2026-06-21 10:00:00-05',
    '2026-06-21 11:15:00-05'
  );

select results_eq(
  $$select count(*)::bigint from public.plan_times where pco_plan_time_id in ('test-elk-time', 'test-lv-time')$$,
  $$values (2::bigint)$$,
  'same-campus detected slots are accepted'
);

select throws_ok(
  $$
    insert into public.plan_time_slot_resolutions
      (plan_time_id, revision, action, slot_id, created_by)
    values (
      (select id from public.plan_times where pco_plan_time_id = 'test-elk-time'),
      1,
      'map',
      (select s.id from public.service_slots s join public.campuses c on c.id = s.campus_id where c.code = 'LV'),
      'test'
    )
  $$,
  '23514',
  'resolved slot must belong to the plan campus',
  'manual slot resolution cannot cross campuses'
);

insert into public.plan_time_slot_resolutions
  (plan_time_id, revision, action, created_by)
values
  ((select id from public.plan_times where pco_plan_time_id = 'test-elk-time'), 1, 'exclude', 'test');

select results_eq(
  $$select is_manually_excluded from public.effective_plan_times where pco_plan_time_id = 'test-elk-time'$$,
  $$values (true)$$,
  'the effective PlanTime view applies an active manual exclusion'
);

insert into public.review_incidents
  (plan_time_id, kind, source_fingerprint)
values
  ((select id from public.plan_times where pco_plan_time_id = 'test-elk-time'), 'reconciliation_gap', 'test-incident');

insert into public.correction_sets
  (incident_id, revision, created_by)
values
  ((select id from public.review_incidents where source_fingerprint = 'test-incident'), 1, 'test');

select throws_ok(
  $$
    insert into public.correction_values
      (correction_set_id, plan_time_id, corrected_actual_seconds)
    values (
      (select id from public.correction_sets where created_by = 'test' and revision = 1),
      (select id from public.plan_times where pco_plan_time_id = 'test-lv-time'),
      4500
    )
  $$,
  '23514',
  'correction target must belong to the incident PlanTime',
  'a correction cannot target another PlanTime'
);

insert into public.correction_values
  (correction_set_id, plan_time_id, corrected_actual_seconds)
values
  (
    (select id from public.correction_sets where created_by = 'test' and revision = 1),
    (select id from public.plan_times where pco_plan_time_id = 'test-elk-time'),
    4500
  );

select results_eq(
  $$
    select corrected_actual_seconds
    from public.correction_values cv
    join public.plan_times pt on pt.id = cv.plan_time_id
    where pt.pco_plan_time_id = 'test-elk-time'
  $$,
  $$values (4500)$$,
  'a correction can target its incident PlanTime'
);

select throws_ok(
  $$
    insert into public.correction_sets (incident_id, revision, created_by)
    values (
      (select id from public.review_incidents where source_fingerprint = 'test-incident'),
      2,
      'test'
    )
  $$,
  '23505',
  null,
  'only one correction revision can be active for an incident'
);

select * from finish();
rollback;

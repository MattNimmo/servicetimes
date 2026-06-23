begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

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
  $$select is_generated::text from information_schema.columns where table_schema = 'public' and table_name = 'plan_times' and column_name = 'actual_service_seconds'$$,
  $$values ('ALWAYS'::text)$$,
  'PlanTime actual duration is generated from raw LIVE bounds'
);

select * from finish();
rollback;

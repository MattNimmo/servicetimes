begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_view('public', 'element_variance', 'element_variance view exists');

select ok(
  not has_table_privilege('anon', 'public.element_variance', 'select'),
  'anon cannot read element variance'
);

select ok(
  has_table_privilege('service_role', 'public.element_variance', 'select'),
  'service role can read element variance'
);

insert into public.plans
  (pco_plan_id, campus_id, service_date, sort_date)
values
  ('variance-plan', (select id from public.campuses where code = 'SLP'), '2026-06-21', '2026-06-21 09:00:00-05');

insert into public.plan_times
  (pco_plan_time_id, plan_id, detected_slot_id, time_type, starts_at, ends_at)
values (
  'variance-time',
  (select id from public.plans where pco_plan_id = 'variance-plan'),
  (select s.id from public.service_slots s join public.campuses c on c.id = s.campus_id where c.code = 'SLP' and s.slot_label = '9am'),
  'service',
  '2026-06-21 09:00:00-05',
  '2026-06-21 10:15:00-05'
);

insert into public.items
  (pco_item_id, plan_id, sequence, raw_title, raw_title_normalized, item_type, section_key, element_key, planned_seconds, resolution_source)
values (
  'variance-item',
  (select id from public.plans where pco_plan_id = 'variance-plan'),
  1,
  'Announcements',
  'announcements',
  'item',
  'mid_service',
  'mid.announcements.general',
  60,
  'alias'
);

select results_eq(
  $$select is_manually_excluded from public.effective_plan_times where pco_plan_time_id = 'variance-time'$$,
  $$values (false)$$,
  'PlanTimes without a manual resolution are not excluded'
);

select results_eq(
  $$select planned_seconds, actual_seconds, actual_is_complete from public.element_variance where plan_id = (select id from public.plans where pco_plan_id = 'variance-plan')$$,
  $$values (60::bigint, null::bigint, false)$$,
  'planned rows survive a missing ItemTime and remain incomplete'
);

insert into public.item_times
  (pco_item_time_id, item_id, plan_time_id, live_start_at, live_end_at, source_fingerprint)
values (
  'variance-item-time',
  (select id from public.items where pco_item_id = 'variance-item'),
  (select id from public.plan_times where pco_plan_time_id = 'variance-time'),
  '2026-06-21 09:10:00-05',
  '2026-06-21 09:10:55-05',
  'variance-fingerprint'
);

select results_eq(
  $$select planned_seconds, actual_seconds, actual_is_complete from public.element_variance where plan_id = (select id from public.plans where pco_plan_id = 'variance-plan')$$,
  $$values (60::bigint, 55::bigint, true)$$,
  'complete ItemTime evidence produces an actual duration'
);

insert into public.item_bucket_overrides
  (item_id, section_key, element_key, created_by)
values (
  (select id from public.items where pco_item_id = 'variance-item'),
  'mid_service',
  'mid.hosted_moment',
  'test'
);

select results_eq(
  $$select element_key from public.element_variance where plan_id = (select id from public.plans where pco_plan_id = 'variance-plan')$$,
  $$values ('mid.hosted_moment'::text)$$,
  'active item bucket overrides change the effective element'
);

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select has_function(
  'public',
  'map_item_to_element',
  array['bigint', 'text', 'text', 'text'],
  'item mapping workflow exists'
);

insert into public.plans
  (pco_plan_id, campus_id, service_date, sort_date)
values
  ('map-test-plan', (select id from public.campuses where code = 'SLP'), '2026-07-05', '2026-07-05 09:00:00-05');

insert into public.items
  (pco_item_id, plan_id, sequence, raw_title, raw_title_normalized, item_type, section_key, element_key, planned_seconds, resolution_source)
values
  (
    'map-test-item',
    (select id from public.plans where pco_plan_id = 'map-test-plan'),
    1,
    'Host Moment',
    'host moment',
    'item',
    null,
    null,
    60,
    'unmapped'
  );

select lives_ok(
  $$select public.map_item_to_element(
    (select id from public.items where pco_item_id = 'map-test-item'),
    'mid.hosted_moment',
    'mid_service',
    'operator'
  )$$,
  'unmapped items can be mapped to a canonical element'
);

select results_eq(
  $$select section_key, element_key, created_by, revoked_at is null
    from public.item_bucket_overrides
    where item_id = (select id from public.items where pco_item_id = 'map-test-item')$$,
  $$values ('mid_service'::text, 'mid.hosted_moment'::text, 'operator'::text, true)$$,
  'mapping stores the selected element and actor'
);

select isnt_empty(
  $$select 1 from public.admin_audit_log
    where actor = 'operator'
      and action = 'item.mapped_to_element'
      and entity_type = 'item_bucket_override'
      and entity_id = (select id::text from public.items where pco_item_id = 'map-test-item')
      and after_state->>'element_key' = 'mid.hosted_moment'$$,
  'mapping writes an audit row'
);

select * from finish();
rollback;

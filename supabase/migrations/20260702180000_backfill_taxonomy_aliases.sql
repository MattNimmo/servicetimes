-- Backfill Phase 2 taxonomy hardening (docs/backfill-ingestion-build-plan.md).
-- 1) "Full service" (MG's run-through name) counts as non-production.
-- 2) Element-alias additions mirroring src/lib/pco/taxonomy.ts (the runtime
--    source of truth) — recorded here so the DB tables stay consistent.

create or replace function public.is_non_production_plan_time(
  p_time_type text,
  p_pco_name text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(p_time_type = 'rehearsal', false)
    or exists (
      select 1
      from unnest(
        array[
          '%rehearsal%',
          '%run through%',
          '%run-through%',
          '%walk through%',
          '%walk-through%',
          '%tech team%',
          '%tech-team%',
          '%translation%',
          '%instrumentalists%',
          '%vocalists%',
          '%broadcast audio%',
          '%full service%'
        ]
      ) as pattern
      where lower(coalesce(p_pco_name, '')) like pattern
    );
$$;

insert into public.element_aliases
  (section_key, raw_title_normalized, match_type, priority, element_key)
values
  ('mid_service', 'greeting groove', 'exact', 10, 'mid.greet'),
  ('mid_service', 'miracle offering', 'exact', 10, 'mid.offering.campaign'),
  ('mid_service', 'host pastor//new guest', 'exact', 10, 'mid.hosted_moment'),
  ('mid_service', 'host pastor/new guest', 'exact', 10, 'mid.hosted_moment'),
  ('live', 'message/bumper', 'exact', 10, 'live.message'),
  ('local', 'response song', 'exact', 10, 'local.worship_response'),
  ('mid_service', 'close worship', 'regex', 20, 'mid.close_worship'),
  ('mid_service', '^(kb )?5 spot', 'regex', 20, 'mid.5spot'),
  ('mid_service', '^child dedication', 'regex', 20, 'mid.hosted_moment'),
  ('local', '^(worship )?response-', 'regex', 20, 'local.worship_response'),
  ('local', '^salvation response', 'regex', 20, 'local.salvation'),
  ('local', '^final prayer', 'regex', 20, 'local.final_prayer')
on conflict (campus_id, section_key, raw_title_normalized, match_type) do update set
  priority = excluded.priority,
  element_key = excluded.element_key;

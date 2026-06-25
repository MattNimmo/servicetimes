-- Expand non-production PlanTime detection beyond rehearsal-only names.

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
          '%broadcast audio%'
        ]
      ) as pattern
      where lower(coalesce(p_pco_name, '')) like pattern
    );
$$;

revoke all on function public.is_non_production_plan_time(text, text)
  from public, anon, authenticated;

-- Enforce campus and occurrence boundaries below the application layer.

create function public.enforce_plan_time_slot_campus()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_campus_id bigint;
  slot_campus_id bigint;
begin
  if new.detected_slot_id is null then
    return new;
  end if;

  select p.campus_id
    into plan_campus_id
    from public.plans p
    where p.id = new.plan_id;

  select s.campus_id
    into slot_campus_id
    from public.service_slots s
    where s.id = new.detected_slot_id;

  if plan_campus_id is distinct from slot_campus_id then
    raise exception 'detected slot must belong to the plan campus'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger plan_times_slot_campus_guard
before insert or update of plan_id, detected_slot_id on public.plan_times
for each row execute function public.enforce_plan_time_slot_campus();

create function public.enforce_slot_resolution_campus()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_campus_id bigint;
  slot_campus_id bigint;
begin
  if new.action = 'exclude' then
    return new;
  end if;

  select p.campus_id
    into plan_campus_id
    from public.plan_times pt
    join public.plans p on p.id = pt.plan_id
    where pt.id = new.plan_time_id;

  select s.campus_id
    into slot_campus_id
    from public.service_slots s
    where s.id = new.slot_id;

  if plan_campus_id is distinct from slot_campus_id then
    raise exception 'resolved slot must belong to the plan campus'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger plan_time_slot_resolutions_campus_guard
before insert or update of plan_time_id, action, slot_id
on public.plan_time_slot_resolutions
for each row execute function public.enforce_slot_resolution_campus();

create function public.enforce_correction_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  incident_plan_time_id bigint;
  incident_plan_id bigint;
  target_plan_time_id bigint;
  target_plan_id bigint;
begin
  select ri.plan_time_id, pt.plan_id
    into incident_plan_time_id, incident_plan_id
    from public.correction_sets cs
    join public.review_incidents ri on ri.id = cs.incident_id
    join public.plan_times pt on pt.id = ri.plan_time_id
    where cs.id = new.correction_set_id;

  if new.plan_time_id is not null then
    target_plan_time_id := new.plan_time_id;
  elsif new.item_time_id is not null then
    select it.plan_time_id
      into target_plan_time_id
      from public.item_times it
      where it.id = new.item_time_id;
  elsif new.item_id is not null then
    select i.plan_id
      into target_plan_id
      from public.items i
      where i.id = new.item_id;
  end if;

  if target_plan_time_id is not null
     and target_plan_time_id is distinct from incident_plan_time_id then
    raise exception 'correction target must belong to the incident PlanTime'
      using errcode = '23514';
  end if;

  if target_plan_id is not null
     and target_plan_id is distinct from incident_plan_id then
    raise exception 'correction item must belong to the incident Plan'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger correction_values_scope_guard
before insert or update of correction_set_id, plan_time_id, item_id, item_time_id
on public.correction_values
for each row execute function public.enforce_correction_scope();

revoke all on function public.enforce_plan_time_slot_campus()
  from public, anon, authenticated;
revoke all on function public.enforce_slot_resolution_campus()
  from public, anon, authenticated;
revoke all on function public.enforce_correction_scope()
  from public, anon, authenticated;

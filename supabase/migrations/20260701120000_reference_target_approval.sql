-- Phase 3 slice 1: reference targets must be explicitly approved before they
-- are treated as anything more than provisional planning numbers.

alter table public.campuses
  add column reference_target_status text not null default 'provisional'
    check (reference_target_status in ('provisional', 'approved')),
  add column reference_target_approved_by text,
  add column reference_target_approved_at timestamptz,
  add constraint campuses_reference_target_approval_consistency check (
    (
      reference_target_status = 'provisional'
      and reference_target_approved_by is null
      and reference_target_approved_at is null
    )
    or (
      reference_target_status = 'approved'
      and reference_target_approved_by is not null
      and reference_target_approved_at is not null
    )
  );

create function public.approve_campus_reference_target(
  p_campus_code text,
  p_reference_target_seconds integer,
  p_approved_by text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_campus_id bigint;
  target_campus_code text;
  before_state jsonb;
  after_state jsonb;
begin
  if p_reference_target_seconds is null or p_reference_target_seconds <= 0 then
    raise exception 'reference target must be a positive duration';
  end if;

  if p_approved_by is null or btrim(p_approved_by) = '' then
    raise exception 'approved_by is required';
  end if;

  select c.id, c.code, to_jsonb(c)
    into target_campus_id, target_campus_code, before_state
  from public.campuses c
  where c.code = upper(p_campus_code)
  for update;

  if target_campus_id is null then
    raise exception 'unknown campus %', p_campus_code;
  end if;

  update public.campuses
  set
    reference_target_seconds = p_reference_target_seconds,
    reference_target_status = 'approved',
    reference_target_approved_by = btrim(p_approved_by),
    reference_target_approved_at = now()
  where id = target_campus_id;

  select to_jsonb(c)
    into after_state
  from public.campuses c
  where c.id = target_campus_id;

  insert into public.admin_audit_log
    (actor, action, entity_type, entity_id, before_state, after_state)
  values
    (
      btrim(p_approved_by),
      'approve_reference_target',
      'campus',
      target_campus_code,
      before_state,
      after_state
    );
end;
$$;

comment on column public.campuses.reference_target_status is
  'provisional until a reviewed campus target is approved through approve_campus_reference_target.';
comment on function public.approve_campus_reference_target(text, integer, text) is
  'Approves a campus reference target and writes the corresponding admin audit row.';

revoke all on function public.approve_campus_reference_target(text, integer, text)
  from public, anon, authenticated;
grant execute on function public.approve_campus_reference_target(text, integer, text)
  to service_role;

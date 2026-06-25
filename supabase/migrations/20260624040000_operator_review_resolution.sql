-- Phase 2A: operator-only incident resolution with append-only audit coverage.

create function public.resolve_review_incident(
  p_incident_id bigint,
  p_resolution text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_record public.review_incidents%rowtype;
  after_record public.review_incidents%rowtype;
begin
  if p_resolution not in ('kept', 'excluded') then
    raise exception 'unsupported review resolution: %', p_resolution
      using errcode = '22023';
  end if;

  if nullif(trim(p_actor), '') is null then
    raise exception 'actor is required'
      using errcode = '22023';
  end if;

  select *
    into before_record
    from public.review_incidents
    where id = p_incident_id
    for update;

  if not found then
    raise exception 'review incident % was not found', p_incident_id
      using errcode = 'P0002';
  end if;

  if before_record.status <> 'open' then
    raise exception 'review incident % is already %', p_incident_id, before_record.status
      using errcode = '23514';
  end if;

  update public.review_incidents
    set status = p_resolution,
        resolved_at = now(),
        resolved_by = p_actor
    where id = p_incident_id
    returning * into after_record;

  insert into public.admin_audit_log (
    actor,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  )
  values (
    p_actor,
    'review_incident.' || p_resolution,
    'review_incident',
    p_incident_id::text,
    to_jsonb(before_record),
    to_jsonb(after_record)
  );

  return jsonb_build_object(
    'ok', true,
    'incident_id', after_record.id,
    'status', after_record.status
  );
end;
$$;

revoke all on function public.resolve_review_incident(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_review_incident(bigint, text, text)
  to service_role;

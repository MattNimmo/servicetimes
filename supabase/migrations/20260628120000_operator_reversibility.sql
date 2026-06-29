-- Operator reversibility: undo a resolved/corrected incident, and unmap an element override.

-- 1) Unified "undo this fix" for a resolved incident.
create function public.reopen_review_incident(
  p_incident_id bigint,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.review_incidents%rowtype;
  v_before jsonb;
begin
  if p_incident_id is null or p_incident_id <= 0 then
    raise exception 'p_incident_id is required' using errcode = '22023';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'p_actor is required' using errcode = '22023';
  end if;

  select * into v_incident
    from public.review_incidents
    where id = p_incident_id
    for update;
  if not found then
    raise exception 'review incident % not found', p_incident_id using errcode = 'P0002';
  end if;
  if v_incident.status = 'open' then
    raise exception 'review incident % is already open', p_incident_id using errcode = '22023';
  end if;

  v_before := to_jsonb(v_incident);

  -- Roll back correction side-effects when the incident was corrected.
  if v_incident.status = 'corrected' then
    update public.correction_sets
      set status = 'reverted'
      where incident_id = p_incident_id and status = 'active';

    if v_incident.plan_time_id is not null then
      update public.plan_time_slot_resolutions
        set superseded_at = now()
        where plan_time_id = v_incident.plan_time_id and superseded_at is null;
    end if;
  end if;

  update public.review_incidents
    set status = 'open', resolved_at = null, resolved_by = null
    where id = p_incident_id;

  insert into public.admin_audit_log (actor, action, entity_type, entity_id, before_state, after_state)
  values (
    p_actor, 'review_incident.reopened', 'review_incident', p_incident_id::text,
    v_before,
    jsonb_build_object('incident_id', p_incident_id, 'status', 'open', 'reverted_from', v_incident.status)
  );

  return jsonb_build_object('ok', true, 'incident_id', p_incident_id, 'status', 'open', 'reverted_from', v_incident.status);
end;
$$;

revoke all on function public.reopen_review_incident(bigint, text) from public, anon, authenticated;
grant execute on function public.reopen_review_incident(bigint, text) to service_role;

-- 2) Unmap: revoke the active item->element override, reverting to the ingested element_key.
create function public.revoke_item_element_mapping(
  p_item_id bigint,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id bigint;
  v_before jsonb;
begin
  if p_item_id is null or p_item_id <= 0 then
    raise exception 'p_item_id is required' using errcode = '22023';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'p_actor is required' using errcode = '22023';
  end if;

  select id, to_jsonb(ibo) into v_existing_id, v_before
    from public.item_bucket_overrides ibo
    where item_id = p_item_id and revoked_at is null
    for update;

  if not found then
    return jsonb_build_object('ok', true, 'item_id', p_item_id, 'revoked', false);
  end if;

  update public.item_bucket_overrides set revoked_at = now() where id = v_existing_id;

  insert into public.admin_audit_log (actor, action, entity_type, entity_id, before_state, after_state)
  values (
    p_actor, 'item.mapping_revoked', 'item_bucket_override', p_item_id::text,
    v_before,
    jsonb_build_object('item_id', p_item_id, 'override_id', v_existing_id, 'revoked', true)
  );

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'override_id', v_existing_id, 'revoked', true);
end;
$$;

revoke all on function public.revoke_item_element_mapping(bigint, text) from public, anon, authenticated;
grant execute on function public.revoke_item_element_mapping(bigint, text) to service_role;

-- Fix map_item_to_element so manual item mappings satisfy the
-- item_bucket_overrides.created_by not-null audit column.

create or replace function public.map_item_to_element(
  p_item_id bigint,
  p_element_key text,
  p_section_key text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id bigint;
  v_before_state jsonb;
  v_new_id bigint;
begin
  if p_item_id is null or p_item_id <= 0 then
    raise exception 'p_item_id is required'
      using errcode = '22023';
  end if;

  if nullif(trim(p_element_key), '') is null then
    raise exception 'p_element_key is required'
      using errcode = '22023';
  end if;

  if nullif(trim(p_section_key), '') is null then
    raise exception 'p_section_key is required'
      using errcode = '22023';
  end if;

  if nullif(trim(p_actor), '') is null then
    raise exception 'p_actor is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.elements
    where key = p_element_key
      and section_key = p_section_key
  ) then
    raise exception 'element % is not in section %', p_element_key, p_section_key
      using errcode = '23503';
  end if;

  select id, to_jsonb(ibo)
    into v_existing_id, v_before_state
    from public.item_bucket_overrides ibo
    where item_id = p_item_id
      and revoked_at is null
    for update;

  if found then
    update public.item_bucket_overrides
    set revoked_at = now()
    where id = v_existing_id;
  end if;

  insert into public.item_bucket_overrides (
    item_id,
    section_key,
    element_key,
    created_at,
    created_by
  )
  values (
    p_item_id,
    p_section_key,
    p_element_key,
    now(),
    p_actor
  )
  returning id into v_new_id;

  insert into public.admin_audit_log (actor, action, entity_type, entity_id, before_state, after_state)
  values (
    p_actor,
    'item.mapped_to_element',
    'item_bucket_override',
    p_item_id::text,
    v_before_state,
    jsonb_build_object(
      'override_id', v_new_id,
      'item_id', p_item_id,
      'element_key', p_element_key,
      'section_key', p_section_key
    )
  );

  return jsonb_build_object(
    'ok', true,
    'override_id', v_new_id,
    'item_id', p_item_id,
    'element_key', p_element_key
  );
end;
$$;

revoke all on function public.map_item_to_element(bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.map_item_to_element(bigint, text, text, text)
  to service_role;

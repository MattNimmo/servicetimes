-- Avoid PL/pgSQL ambiguity between the local campus ID and service_slots.campus_id.

create or replace function public.ingest_pco_plan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  translated jsonb := payload;
  resolved_campus_id bigint;
  entry jsonb;
  entries jsonb := '[]'::jsonb;
  legacy_label text;
begin
  select c.id into resolved_campus_id
  from public.campuses c
  where c.code = payload->>'campus';

  if resolved_campus_id is null then
    raise exception 'unknown campus code: %', payload->>'campus'
      using errcode = '22023';
  end if;

  for entry in
    select value from jsonb_array_elements(coalesce(payload->'planTimes', '[]'::jsonb))
  loop
    if nullif(entry->>'detectedSlotKey', '') is not null then
      select s.slot_label into legacy_label
      from public.service_slots s
      where s.campus_id = resolved_campus_id
        and s.slot_key = entry->>'detectedSlotKey';

      if legacy_label is null then
        raise exception 'unknown slot key % for campus %',
          entry->>'detectedSlotKey', payload->>'campus'
          using errcode = '22023';
      end if;

      entry := entry || jsonb_build_object('detectedSlotLabel', legacy_label);
    end if;
    entries := entries || jsonb_build_array(entry);
  end loop;
  translated := jsonb_set(translated, '{planTimes}', entries, true);

  entries := '[]'::jsonb;
  for entry in
    select value from jsonb_array_elements(coalesce(payload->'incidents', '[]'::jsonb))
  loop
    if nullif(entry->>'slotKey', '') is not null then
      select s.slot_label into legacy_label
      from public.service_slots s
      where s.campus_id = resolved_campus_id
        and s.slot_key = entry->>'slotKey';

      if legacy_label is null then
        raise exception 'unknown incident slot key % for campus %',
          entry->>'slotKey', payload->>'campus'
          using errcode = '22023';
      end if;

      entry := entry || jsonb_build_object('slotLabel', legacy_label);
    end if;
    entries := entries || jsonb_build_array(entry);
  end loop;
  translated := jsonb_set(translated, '{incidents}', entries, true);

  return public.ingest_pco_plan_legacy(translated);
end;
$$;

revoke all on function public.ingest_pco_plan(jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_pco_plan(jsonb) to service_role;

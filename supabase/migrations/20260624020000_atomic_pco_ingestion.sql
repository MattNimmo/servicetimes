-- Slot-scoped review evidence and one-call transactional PCO ingestion.

alter table public.review_incidents
  add column plan_id bigint references public.plans(id),
  add column slot_id bigint references public.service_slots(id),
  add column detail text not null default '',
  add column evidence jsonb not null default '{}'::jsonb;

alter table public.review_incidents
  alter column plan_time_id drop not null;

alter table public.review_incidents
  drop constraint review_incidents_status_check,
  drop constraint review_incidents_check;

alter table public.review_incidents
  add constraint review_incidents_status_check
    check (status in ('open', 'kept', 'corrected', 'excluded', 'superseded')),
  add constraint review_incidents_resolution_check check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status <> 'open' and resolved_at is not null and resolved_by is not null)
  ),
  add constraint review_incidents_scope_check check (
    (plan_time_id is not null and plan_id is null and slot_id is null)
    or (plan_time_id is null and plan_id is not null and slot_id is not null)
  );

drop index public.review_incidents_one_open_source_kind;

create unique index review_incidents_one_open_plan_time_source
  on public.review_incidents(plan_time_id, kind, source_fingerprint)
  where status = 'open' and plan_time_id is not null;

create unique index review_incidents_one_open_slot_source
  on public.review_incidents(plan_id, slot_id, kind, source_fingerprint)
  where status = 'open' and plan_time_id is null;

create index review_incidents_plan_id on public.review_incidents(plan_id);
create index review_incidents_slot_id on public.review_incidents(slot_id);

create function public.enforce_review_incident_slot_campus()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_campus_id bigint;
  slot_campus_id bigint;
begin
  if new.plan_time_id is not null then
    return new;
  end if;

  select p.campus_id into plan_campus_id
    from public.plans p
    where p.id = new.plan_id;

  select s.campus_id into slot_campus_id
    from public.service_slots s
    where s.id = new.slot_id;

  if plan_campus_id is distinct from slot_campus_id then
    raise exception 'review incident slot must belong to the plan campus'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger review_incidents_slot_campus_guard
before insert or update of plan_time_id, plan_id, slot_id
on public.review_incidents
for each row execute function public.enforce_review_incident_slot_campus();

create function public.ingest_pco_plan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campus_record public.campuses%rowtype;
  plan_record public.plans%rowtype;
  ingest_run_id bigint;
  entry jsonb;
  incident_record public.review_incidents%rowtype;
  resolved_plan_time_id bigint;
  resolved_slot_id bigint;
  resolved_item_id bigint;
  item_pco_id text;
  service_date date;
  plan_time_count integer;
  item_count integer;
  item_time_count integer;
  incident_count integer;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'ingestion payload must be a JSON object'
      using errcode = '22023';
  end if;

  if coalesce((payload->>'dryRun')::boolean, true) then
    raise exception 'atomic ingestion requires dryRun=false'
      using errcode = '22023';
  end if;

  select * into campus_record
    from public.campuses c
    where c.code = payload->>'campus';

  if campus_record.id is null then
    raise exception 'unknown campus code: %', payload->>'campus'
      using errcode = '22023';
  end if;

  service_date := (payload->'plan'->>'serviceDate')::date;

  insert into public.ingest_runs (kind, window_start, window_end)
  values ('actuals', service_date, service_date)
  returning id into ingest_run_id;

  insert into public.plans (
    pco_plan_id,
    campus_id,
    service_date,
    sort_date,
    series_title,
    title,
    pco_total_length_seconds,
    pulled_at,
    source_updated_at
  ) values (
    payload->'plan'->>'pcoPlanId',
    campus_record.id,
    service_date,
    (payload->'plan'->>'sortDate')::timestamptz,
    nullif(payload->'plan'->>'seriesTitle', ''),
    nullif(payload->'plan'->>'title', ''),
    nullif(payload->'plan'->>'pcoTotalLengthSeconds', '')::integer,
    now(),
    nullif(payload->'plan'->>'sourceUpdatedAt', '')::timestamptz
  )
  on conflict (pco_plan_id) do update set
    campus_id = excluded.campus_id,
    service_date = excluded.service_date,
    sort_date = excluded.sort_date,
    series_title = excluded.series_title,
    title = excluded.title,
    pco_total_length_seconds = excluded.pco_total_length_seconds,
    pulled_at = excluded.pulled_at,
    source_updated_at = excluded.source_updated_at
  returning * into plan_record;

  update public.items
    set seen_in_last_pull = false
    where plan_id = plan_record.id;

  for entry in
    select value from jsonb_array_elements(coalesce(payload->'planTimes', '[]'::jsonb))
  loop
    resolved_slot_id := null;
    if nullif(entry->>'detectedSlotLabel', '') is not null then
      select s.id into resolved_slot_id
        from public.service_slots s
        where s.campus_id = campus_record.id
          and s.slot_label = entry->>'detectedSlotLabel';

      if resolved_slot_id is null then
        raise exception 'unknown slot % for campus %',
          entry->>'detectedSlotLabel', campus_record.code
          using errcode = '22023';
      end if;
    end if;

    insert into public.plan_times (
      pco_plan_time_id,
      plan_id,
      detected_slot_id,
      slot_resolution_state,
      pco_name,
      time_type,
      starts_at,
      ends_at,
      live_starts_at,
      live_ends_at,
      recorded,
      pulled_at
    ) values (
      entry->>'pcoPlanTimeId',
      plan_record.id,
      resolved_slot_id,
      entry->>'slotResolutionState',
      nullif(entry->>'pcoName', ''),
      entry->>'timeType',
      nullif(entry->>'startsAt', '')::timestamptz,
      nullif(entry->>'endsAt', '')::timestamptz,
      nullif(entry->>'liveStartsAt', '')::timestamptz,
      nullif(entry->>'liveEndsAt', '')::timestamptz,
      coalesce((entry->>'recorded')::boolean, false),
      now()
    )
    on conflict (pco_plan_time_id) do update set
      plan_id = excluded.plan_id,
      detected_slot_id = excluded.detected_slot_id,
      slot_resolution_state = excluded.slot_resolution_state,
      pco_name = excluded.pco_name,
      time_type = excluded.time_type,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      live_starts_at = excluded.live_starts_at,
      live_ends_at = excluded.live_ends_at,
      recorded = excluded.recorded,
      pulled_at = excluded.pulled_at;
  end loop;

  for entry in
    select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into public.items (
      pco_item_id,
      plan_id,
      sequence,
      raw_title,
      raw_title_normalized,
      item_type,
      service_position,
      section_key,
      element_key,
      planned_seconds,
      is_rollup_child,
      resolution_source,
      seen_in_last_pull,
      pulled_at
    ) values (
      entry->>'pcoItemId',
      plan_record.id,
      (entry->>'sequence')::integer,
      entry->>'rawTitle',
      entry->>'rawTitleNormalized',
      entry->>'itemType',
      nullif(entry->>'servicePosition', ''),
      nullif(entry->>'sectionKey', ''),
      nullif(entry->>'elementKey', ''),
      nullif(entry->>'plannedSeconds', '')::integer,
      coalesce((entry->>'isRollupChild')::boolean, false),
      entry->>'resolutionSource',
      true,
      now()
    )
    on conflict (pco_item_id) do update set
      plan_id = excluded.plan_id,
      sequence = excluded.sequence,
      raw_title = excluded.raw_title,
      raw_title_normalized = excluded.raw_title_normalized,
      item_type = excluded.item_type,
      service_position = excluded.service_position,
      section_key = excluded.section_key,
      element_key = excluded.element_key,
      planned_seconds = excluded.planned_seconds,
      is_rollup_child = excluded.is_rollup_child,
      resolution_source = excluded.resolution_source,
      seen_in_last_pull = true,
      pulled_at = excluded.pulled_at;
  end loop;

  for entry in
    select value from jsonb_array_elements(coalesce(payload->'itemTimes', '[]'::jsonb))
  loop
    select i.id into resolved_item_id
      from public.items i
      where i.pco_item_id = entry->>'pcoItemId'
        and i.plan_id = plan_record.id;

    select pt.id into resolved_plan_time_id
      from public.plan_times pt
      where pt.pco_plan_time_id = entry->>'pcoPlanTimeId'
        and pt.plan_id = plan_record.id;

    if resolved_item_id is null or resolved_plan_time_id is null then
      raise exception 'ItemTime % references an unknown item or PlanTime',
        entry->>'pcoItemTimeId'
        using errcode = '23503';
    end if;

    insert into public.item_times (
      pco_item_time_id,
      item_id,
      plan_time_id,
      pco_length_seconds,
      length_offset_seconds,
      live_start_at,
      live_end_at,
      pco_exclude,
      source_fingerprint,
      pulled_at
    ) values (
      entry->>'pcoItemTimeId',
      resolved_item_id,
      resolved_plan_time_id,
      nullif(entry->>'pcoLengthSeconds', '')::integer,
      nullif(entry->>'lengthOffsetSeconds', '')::integer,
      nullif(entry->>'liveStartAt', '')::timestamptz,
      nullif(entry->>'liveEndAt', '')::timestamptz,
      coalesce((entry->>'pcoExclude')::boolean, false),
      entry->>'sourceFingerprint',
      now()
    )
    on conflict (pco_item_time_id) do update set
      item_id = excluded.item_id,
      plan_time_id = excluded.plan_time_id,
      pco_length_seconds = excluded.pco_length_seconds,
      length_offset_seconds = excluded.length_offset_seconds,
      live_start_at = excluded.live_start_at,
      live_end_at = excluded.live_end_at,
      pco_exclude = excluded.pco_exclude,
      source_fingerprint = excluded.source_fingerprint,
      pulled_at = excluded.pulled_at;
  end loop;

  for entry in
    select value from jsonb_array_elements(coalesce(payload->'incidents', '[]'::jsonb))
  loop
    resolved_plan_time_id := null;
    resolved_slot_id := null;

    if nullif(entry->>'planTimeId', '') is not null then
      select pt.id into resolved_plan_time_id
        from public.plan_times pt
        where pt.pco_plan_time_id = entry->>'planTimeId'
          and pt.plan_id = plan_record.id;

      if resolved_plan_time_id is null then
        raise exception 'incident references unknown PlanTime %', entry->>'planTimeId'
          using errcode = '23503';
      end if;

      insert into public.review_incidents (
        plan_time_id, kind, source_fingerprint, detail, evidence
      ) values (
        resolved_plan_time_id,
        entry->>'kind',
        entry->>'sourceFingerprint',
        entry->>'detail',
        coalesce(entry->'evidence', '{}'::jsonb)
      )
      on conflict (plan_time_id, kind, source_fingerprint)
        where status = 'open' and plan_time_id is not null
      do update set
        detail = excluded.detail,
        evidence = excluded.evidence
      returning * into incident_record;
    else
      select s.id into resolved_slot_id
        from public.service_slots s
        where s.campus_id = campus_record.id
          and s.slot_label = entry->>'slotLabel';

      if resolved_slot_id is null then
        raise exception 'slot-scoped incident references unknown slot %', entry->>'slotLabel'
          using errcode = '23503';
      end if;

      insert into public.review_incidents (
        plan_id, slot_id, kind, source_fingerprint, detail, evidence
      ) values (
        plan_record.id,
        resolved_slot_id,
        entry->>'kind',
        entry->>'sourceFingerprint',
        entry->>'detail',
        coalesce(entry->'evidence', '{}'::jsonb)
      )
      on conflict (plan_id, slot_id, kind, source_fingerprint)
        where status = 'open' and plan_time_id is null
      do update set
        detail = excluded.detail,
        evidence = excluded.evidence
      returning * into incident_record;
    end if;

    delete from public.review_incident_items rii
      where rii.incident_id = incident_record.id;

    for item_pco_id in
      select value #>> '{}'
        from jsonb_array_elements(coalesce(entry->'itemIds', '[]'::jsonb))
    loop
      select i.id into resolved_item_id
        from public.items i
        where i.pco_item_id = item_pco_id
          and i.plan_id = plan_record.id;

      if resolved_item_id is null then
        raise exception 'incident references unknown item %', item_pco_id
          using errcode = '23503';
      end if;

      insert into public.review_incident_items (incident_id, item_id)
      values (incident_record.id, resolved_item_id);
    end loop;
  end loop;

  update public.review_incidents ri
    set status = 'superseded',
        resolved_at = now(),
        resolved_by = 'ingestion'
    where ri.status = 'open'
      and (
        ri.plan_id = plan_record.id
        or ri.plan_time_id in (
          select pt.id from public.plan_times pt where pt.plan_id = plan_record.id
        )
      )
      and not exists (
        select 1
          from jsonb_array_elements(coalesce(payload->'incidents', '[]'::jsonb)) current_incident
          where current_incident->>'sourceFingerprint' = ri.source_fingerprint
            and current_incident->>'kind' = ri.kind
      );

  plan_time_count := jsonb_array_length(coalesce(payload->'planTimes', '[]'::jsonb));
  item_count := jsonb_array_length(coalesce(payload->'items', '[]'::jsonb));
  item_time_count := jsonb_array_length(coalesce(payload->'itemTimes', '[]'::jsonb));
  incident_count := jsonb_array_length(coalesce(payload->'incidents', '[]'::jsonb));

  update public.ingest_runs
    set finished_at = now(),
        status = 'ok',
        plans_upserted = 1,
        items_upserted = item_count,
        unmapped_count = coalesce((payload->'summary'->>'unmappedItemCount')::integer, 0)
    where id = ingest_run_id;

  return jsonb_build_object(
    'ingestRunId', ingest_run_id,
    'pcoPlanId', plan_record.pco_plan_id,
    'planTimesUpserted', plan_time_count,
    'itemsUpserted', item_count,
    'itemTimesUpserted', item_time_count,
    'incidentsObserved', incident_count
  );
end;
$$;

revoke all on function public.enforce_review_incident_slot_campus()
  from public, anon, authenticated;
revoke all on function public.ingest_pco_plan(jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_pco_plan(jsonb) to service_role;

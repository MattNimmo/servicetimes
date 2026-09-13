begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select results_eq(
  $$select count(*)::bigint from public.service_slots where not is_run_through$$,
  $$values (7::bigint)$$,
  'the migration preserves the seven stable production slot rows'
);

select results_eq(
  $$select count(*)::bigint from public.service_slots where slot_key in ('first', 'second')$$,
  $$values (7::bigint)$$,
  'every production service has a stable first/second identity'
);

select results_eq(
  $$
    select concat_ws(':', s.slot_label, s.expected_local_start::text)
    from public.service_slots s
    join public.campuses c on c.id = s.campus_id
    where c.code = 'ELK' and s.slot_key = 'second'
  $$,
  $$values ('11am:11:00:00'::text)$$,
  'the existing Elk River second-service row remains the legacy compatibility row'
);

select results_eq(
  $$
    select slot_label
    from public.service_slot_schedule_ranges ss
    join public.campuses c on c.id = ss.campus_id
    where c.code = 'ELK'
      and ss.slot_key = 'second'
      and (ss.effective_from is null or ss.effective_from <= '2026-08-23')
      and (ss.effective_until is null or '2026-08-23' < ss.effective_until)
  $$,
  $$values ('11am'::text)$$,
  'Elk River history resolves the second service to 11am before August 30'
);

select results_eq(
  $$
    select slot_label
    from public.service_slot_schedule_ranges ss
    join public.campuses c on c.id = ss.campus_id
    where c.code = 'ELK'
      and ss.slot_key = 'second'
      and (ss.effective_from is null or ss.effective_from <= '2026-08-30')
      and (ss.effective_until is null or '2026-08-30' < ss.effective_until)
  $$,
  $$values ('10:30am'::text)$$,
  'Elk River resolves the second service to 10:30am beginning August 30'
);

select results_eq(
  $$
    select expected_local_start
    from public.service_slot_schedule_ranges ss
    join public.campuses c on c.id = ss.campus_id
    where c.code = 'ELK'
      and ss.slot_key = 'second'
      and (ss.effective_from is null or ss.effective_from <= '2026-08-30')
      and (ss.effective_until is null or '2026-08-30' < ss.effective_until)
  $$,
  $$values ('10:30'::time)$$,
  'the post-transition Elk River schedule expects a 10:30 local start'
);

select throws_ok(
  $$
    insert into public.service_slot_schedules (
      slot_id,
      effective_during,
      display_label,
      expected_local_start
    ) values (
      (
        select s.id
        from public.service_slots s
        join public.campuses c on c.id = s.campus_id
        where c.code = 'ELK' and s.slot_key = 'second'
      ),
      daterange('2026-09-01', null, '[)'),
      'conflict',
      '10:45'
    )
  $$,
  '23P01',
  null,
  'effective schedules for the same stable slot cannot overlap'
);

select has_view(
  'public',
  'ingestion_location_health',
  'shared ingestion location health view exists'
);

select has_function(
  'public',
  'ingest_pco_plan',
  array['jsonb'],
  'the public ingestion RPC remains available after adding key translation'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.service_slot_schedules'::regclass),
  'RLS is enabled on service slot schedules'
);

create temporary table transition_existing_slot as
select s.id
from public.service_slots s
join public.campuses c on c.id = s.campus_id
where c.code = 'ELK' and s.slot_key = 'second';

select lives_ok(
  $ingest$
    select public.ingest_pco_plan(
      $json$
      {
        "campus": "ELK",
        "dryRun": false,
        "plan": {
          "pcoPlanId": "transition-key-plan",
          "serviceDate": "2026-08-30",
          "sortDate": "2026-08-30T15:30:00Z",
          "seriesTitle": "Transition",
          "title": "Stable key fixture",
          "pcoTotalLengthSeconds": 3600,
          "sourceUpdatedAt": "2026-08-31T12:00:00Z"
        },
        "planTimes": [{
          "pcoPlanTimeId": "transition-key-time",
          "detectedSlotKey": "second",
          "detectedSlotLabel": "10:30am",
          "slotResolutionState": "auto",
          "pcoName": "10:30 Service",
          "timeType": "service",
          "startsAt": "2026-08-30T15:30:00Z",
          "endsAt": "2026-08-30T16:30:00Z",
          "liveStartsAt": "2026-08-30T15:30:00Z",
          "liveEndsAt": "2026-08-30T16:30:00Z",
          "recorded": true
        }],
        "items": [{
          "pcoItemId": "transition-key-item",
          "sequence": 1,
          "rawTitle": "Message",
          "rawTitleNormalized": "message",
          "itemType": "item",
          "servicePosition": "during",
          "sectionKey": "live",
          "elementKey": "live.message",
          "plannedSeconds": 3600,
          "isRollupChild": false,
          "resolutionSource": "alias"
        }],
        "itemTimes": [{
          "pcoItemTimeId": "transition-key-item-time",
          "pcoItemId": "transition-key-item",
          "pcoPlanTimeId": "transition-key-time",
          "pcoLengthSeconds": 3600,
          "lengthOffsetSeconds": 0,
          "liveStartAt": "2026-08-30T15:30:00Z",
          "liveEndAt": "2026-08-30T16:30:00Z",
          "pcoExclude": false,
          "sourceFingerprint": "transition-key-item-time-fingerprint"
        }],
        "incidents": [{
          "kind": "slot_resolution",
          "planTimeId": null,
          "slotKey": "second",
          "slotLabel": "10:30am",
          "itemIds": [],
          "sourceFingerprint": "transition-key-incident",
          "detail": "Stable-key incident fixture",
          "evidence": {"source": "pgTAP"}
        }],
        "summary": {"unmappedItemCount": 0}
      }
      $json$::jsonb
    )
  $ingest$,
  'the ingestion RPC accepts stable service keys'
);

select results_eq(
  $$
    select pt.detected_slot_id
    from public.plan_times pt
    where pt.pco_plan_time_id = 'transition-key-time'
  $$,
  $$select id from transition_existing_slot$$,
  'detectedSlotKey second resolves to the existing Elk River slot ID'
);

select results_eq(
  $$
    select ri.slot_id
    from public.review_incidents ri
    where ri.source_fingerprint = 'transition-key-incident'
  $$,
  $$select id from transition_existing_slot$$,
  'incident slotKey second resolves to the existing Elk River slot ID'
);

select results_eq(
  $$
    select distinct ev.slot_label
    from public.element_variance ev
    join public.plans p on p.id = ev.plan_id
    where p.pco_plan_id = 'transition-key-plan'
  $$,
  $$values ('10:30am'::text)$$,
  'historical variance uses the display label effective on the service date'
);

select results_eq(
  $$
    select is_complete
    from public.ingestion_location_health
    where pco_plan_id = 'transition-key-plan'
  $$,
  $$values (false)$$,
  'a plan with a missing expected service and blocking incident is incomplete'
);

select * from finish();

rollback;

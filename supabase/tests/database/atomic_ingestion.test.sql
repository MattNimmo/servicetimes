begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_function(
  'public',
  'ingest_pco_plan',
  array['jsonb'],
  'atomic ingestion RPC exists'
);

create temporary table test_ingestion_payload (payload jsonb not null);

insert into test_ingestion_payload values (
  $json$
  {
    "campus": "LV",
    "dryRun": false,
    "plan": {
      "pcoPlanId": "atomic-plan",
      "serviceDate": "2026-06-21",
      "sortDate": "2026-06-21T15:00:00Z",
      "seriesTitle": "Atomic Series",
      "title": "Atomic Weekend",
      "pcoTotalLengthSeconds": 4500,
      "sourceUpdatedAt": "2026-06-22T12:00:00Z"
    },
    "planTimes": [
      {
        "pcoPlanTimeId": "atomic-time",
        "detectedSlotLabel": "10am",
        "slotResolutionState": "auto",
        "pcoName": "Service",
        "timeType": "service",
        "startsAt": "2026-06-21T15:00:00Z",
        "endsAt": "2026-06-21T16:15:00Z",
        "liveStartsAt": "2026-06-21T15:00:00Z",
        "liveEndsAt": "2026-06-21T16:10:00Z",
        "recorded": true
      }
    ],
    "items": [
      {
        "pcoItemId": "atomic-header",
        "sequence": 1,
        "rawTitle": "Live",
        "rawTitleNormalized": "live",
        "itemType": "header",
        "servicePosition": "during",
        "sectionKey": "live",
        "elementKey": null,
        "plannedSeconds": 0,
        "isRollupChild": false,
        "resolutionSource": "structural"
      },
      {
        "pcoItemId": "atomic-message",
        "sequence": 2,
        "rawTitle": "Message",
        "rawTitleNormalized": "message",
        "itemType": "item",
        "servicePosition": "during",
        "sectionKey": "live",
        "elementKey": "live.message",
        "plannedSeconds": 4200,
        "isRollupChild": false,
        "resolutionSource": "alias"
      }
    ],
    "itemTimes": [
      {
        "pcoItemTimeId": "atomic-item-time",
        "pcoItemId": "atomic-message",
        "pcoPlanTimeId": "atomic-time",
        "pcoLengthSeconds": 4200,
        "lengthOffsetSeconds": 0,
        "liveStartAt": "2026-06-21T15:00:00Z",
        "liveEndAt": "2026-06-21T16:10:00Z",
        "pcoExclude": false,
        "sourceFingerprint": "atomic-item-time-fingerprint"
      }
    ],
    "incidents": [
      {
        "kind": "slot_resolution",
        "planTimeId": null,
        "slotLabel": "10am",
        "itemIds": [],
        "sourceFingerprint": "atomic-slot-fingerprint",
        "detail": "Fixture slot review",
        "evidence": {"reason": "fixture"}
      },
      {
        "kind": "zero_allotment",
        "planTimeId": "atomic-time",
        "slotLabel": "10am",
        "itemIds": ["atomic-message"],
        "sourceFingerprint": "atomic-item-incident-fingerprint",
        "detail": "Fixture item review",
        "evidence": {"actualSeconds": 4200}
      }
    ],
    "summary": {"unmappedItemCount": 0}
  }
  $json$::jsonb
);

select lives_ok(
  $$select public.ingest_pco_plan((select payload from test_ingestion_payload))$$,
  'a valid ingestion payload commits atomically'
);

select results_eq(
  $$select count(*)::bigint from public.plans where pco_plan_id = 'atomic-plan'$$,
  $$values (1::bigint)$$,
  'the plan is stored once'
);

select results_eq(
  $$select count(*)::bigint from public.plan_times where pco_plan_time_id = 'atomic-time'$$,
  $$values (1::bigint)$$,
  'the PlanTime is stored once'
);

select results_eq(
  $$select count(*)::bigint from public.items where pco_item_id like 'atomic-%'$$,
  $$values (2::bigint)$$,
  'all current items are stored'
);

select results_eq(
  $$select count(*)::bigint from public.item_times where pco_item_time_id = 'atomic-item-time'$$,
  $$values (1::bigint)$$,
  'the ItemTime is stored once'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.review_incidents ri
    join public.plans p on p.id = ri.plan_id
    join public.service_slots s on s.id = ri.slot_id
    where p.pco_plan_id = 'atomic-plan'
      and s.slot_label = '10am'
      and ri.detail = 'Fixture slot review'
      and ri.evidence = '{"reason":"fixture"}'::jsonb
  $$,
  $$values (1::bigint)$$,
  'slot-scoped incident evidence is stored'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.review_incident_items rii
    join public.review_incidents ri on ri.id = rii.incident_id
    join public.items i on i.id = rii.item_id
    where ri.source_fingerprint = 'atomic-item-incident-fingerprint'
      and i.pco_item_id = 'atomic-message'
  $$,
  $$values (1::bigint)$$,
  'incident item relationships are stored'
);

select public.ingest_pco_plan((select payload from test_ingestion_payload));

select results_eq(
  $$
    select concat_ws(':',
      (select count(*) from public.plans where pco_plan_id = 'atomic-plan'),
      (select count(*) from public.plan_times where pco_plan_time_id = 'atomic-time'),
      (select count(*) from public.items where pco_item_id like 'atomic-%'),
      (select count(*) from public.item_times where pco_item_time_id = 'atomic-item-time'),
      (select count(*) from public.review_incidents where source_fingerprint like 'atomic-%-fingerprint')
    )
  $$,
  $$values ('1:1:2:1:2'::text)$$,
  'replaying the same payload is idempotent'
);

update test_ingestion_payload
set payload = jsonb_set(
  jsonb_set(
    jsonb_set(payload, '{items}', jsonb_build_array(payload->'items'->0)),
    '{itemTimes}',
    '[]'::jsonb
  ),
  '{incidents}',
  '[]'::jsonb
);

select public.ingest_pco_plan((select payload from test_ingestion_payload));

select results_eq(
  $$select seen_in_last_pull from public.items where pco_item_id = 'atomic-message'$$,
  $$values (false)$$,
  'an item omitted from a later pull is marked stale'
);

select results_eq(
  $$select count(*)::bigint from public.review_incidents where status = 'open' and source_fingerprint like 'atomic-%-fingerprint'$$,
  $$values (0::bigint)$$,
  'incidents absent from a later pull are superseded'
);

update test_ingestion_payload
set payload = jsonb_set(
  jsonb_set(
    jsonb_set(payload, '{plan,title}', '"Should Roll Back"'::jsonb),
    '{itemTimes}',
    '[{"pcoItemTimeId":"invalid-time","pcoItemId":"missing-item","pcoPlanTimeId":"atomic-time","sourceFingerprint":"invalid"}]'::jsonb
  ),
  '{dryRun}',
  'false'::jsonb
);

select throws_ok(
  $$select public.ingest_pco_plan((select payload from test_ingestion_payload))$$,
  '23503',
  'ItemTime invalid-time references an unknown item or PlanTime',
  'an invalid child reference aborts ingestion'
);

select results_eq(
  $$select title from public.plans where pco_plan_id = 'atomic-plan'$$,
  $$values ('Atomic Weekend'::text)$$,
  'a failed ingestion rolls back earlier plan updates'
);

update test_ingestion_payload
set payload = jsonb_set(payload, '{dryRun}', 'true'::jsonb);

select throws_ok(
  $$select public.ingest_pco_plan((select payload from test_ingestion_payload))$$,
  '22023',
  'atomic ingestion requires dryRun=false',
  'dry-run payloads cannot reach the writer'
);

update test_ingestion_payload
set payload = jsonb_set(
  jsonb_set(payload, '{dryRun}', 'false'::jsonb),
  '{campus}',
  '"NOPE"'::jsonb
);

select throws_ok(
  $$select public.ingest_pco_plan((select payload from test_ingestion_payload))$$,
  '22023',
  'unknown campus code: NOPE',
  'unknown campuses are rejected'
);

select results_eq(
  $$select count(*)::bigint from public.ingest_runs where status = 'ok' and window_start = '2026-06-21'$$,
  $$values (3::bigint)$$,
  'successful ingestion runs are audited'
);

select * from finish();
rollback;

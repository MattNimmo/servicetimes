-- ECC Service Times v2: initial production schema.
-- Raw Planning Center values remain intact. All human changes are overlays.

create table public.campuses (
  id bigint primary key generated always as identity,
  code text not null unique check (code = upper(code)),
  name text not null,
  pco_service_type_id text not null unique,
  timezone text not null default 'America/Chicago',
  is_broadcast_origin boolean not null default false,
  reference_target_seconds integer not null default 4500
    check (reference_target_seconds > 0),
  created_at timestamptz not null default now()
);

create table public.service_slots (
  id bigint primary key generated always as identity,
  campus_id bigint not null references public.campuses(id),
  slot_label text not null,
  expected_local_start time not null,
  match_tolerance_minutes integer not null default 10
    check (match_tolerance_minutes between 0 and 60),
  is_run_through boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campus_id, slot_label),
  unique (campus_id, expected_local_start)
);

create table public.sections (
  key text primary key,
  display_name text not null,
  sort_order integer not null unique,
  is_analytics_eligible boolean not null default true
);

create table public.elements (
  key text primary key,
  parent_key text references public.elements(key),
  section_key text not null references public.sections(key),
  display_name text not null,
  is_tracked boolean not null default true,
  is_lever_eligible boolean not null default true,
  applies_to_campuses text[],
  sort_order integer not null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  check (parent_key is null or parent_key <> key),
  unique (section_key, sort_order)
);

create table public.element_redirects (
  retired_element_key text primary key references public.elements(key),
  surviving_element_key text not null references public.elements(key),
  created_at timestamptz not null default now(),
  created_by text not null,
  check (retired_element_key <> surviving_element_key)
);

create table public.section_aliases (
  id bigint primary key generated always as identity,
  campus_id bigint references public.campuses(id),
  raw_title_normalized text not null,
  match_type text not null default 'exact'
    check (match_type in ('exact', 'regex')),
  priority integer not null default 100,
  section_key text not null references public.sections(key),
  created_at timestamptz not null default now(),
  created_by text,
  unique nulls not distinct
    (campus_id, raw_title_normalized, match_type)
);

create table public.element_aliases (
  id bigint primary key generated always as identity,
  campus_id bigint references public.campuses(id),
  section_key text not null references public.sections(key),
  raw_title_normalized text not null,
  match_type text not null default 'exact'
    check (match_type in ('exact', 'regex')),
  priority integer not null default 100,
  element_key text not null references public.elements(key),
  created_at timestamptz not null default now(),
  created_by text,
  unique nulls not distinct
    (campus_id, section_key, raw_title_normalized, match_type)
);

create table public.plans (
  id bigint primary key generated always as identity,
  pco_plan_id text not null unique,
  campus_id bigint not null references public.campuses(id),
  service_date date not null,
  sort_date timestamptz not null,
  series_title text,
  title text,
  pco_total_length_seconds integer,
  pulled_at timestamptz not null default now(),
  source_updated_at timestamptz,
  unique (campus_id, service_date, pco_plan_id)
);

create table public.plan_times (
  id bigint primary key generated always as identity,
  pco_plan_time_id text not null unique,
  plan_id bigint not null references public.plans(id),
  detected_slot_id bigint references public.service_slots(id),
  slot_resolution_state text not null default 'review'
    check (slot_resolution_state in ('auto', 'review')),
  pco_name text,
  time_type text not null
    check (time_type in ('rehearsal', 'service', 'other')),
  starts_at timestamptz,
  ends_at timestamptz,
  live_starts_at timestamptz,
  live_ends_at timestamptz,
  recorded boolean not null default false,
  planned_target_seconds integer generated always as (
    case
      when starts_at is not null and ends_at is not null
        then extract(epoch from (ends_at - starts_at))::integer
      else null
    end
  ) stored,
  actual_service_seconds integer generated always as (
    case
      when live_starts_at is not null and live_ends_at is not null
        then extract(epoch from (live_ends_at - live_starts_at))::integer
      else null
    end
  ) stored,
  pulled_at timestamptz not null default now()
);

-- Manual slot decisions are occurrence-only, revisioned, and never written to PCO.
create table public.plan_time_slot_resolutions (
  id bigint primary key generated always as identity,
  plan_time_id bigint not null references public.plan_times(id),
  revision integer not null check (revision > 0),
  action text not null check (action in ('map', 'exclude')),
  slot_id bigint references public.service_slots(id),
  created_at timestamptz not null default now(),
  created_by text not null,
  superseded_at timestamptz,
  check (
    (action = 'map' and slot_id is not null)
    or (action = 'exclude' and slot_id is null)
  ),
  unique (plan_time_id, revision)
);

create unique index plan_time_slot_resolutions_one_active
  on public.plan_time_slot_resolutions(plan_time_id)
  where superseded_at is null;

create table public.items (
  id bigint primary key generated always as identity,
  pco_item_id text not null unique,
  plan_id bigint not null references public.plans(id),
  sequence integer not null check (sequence >= 0),
  raw_title text not null,
  raw_title_normalized text not null,
  item_type text not null
    check (item_type in ('song', 'header', 'media', 'item')),
  service_position text
    check (service_position is null or service_position in ('pre', 'during', 'post')),
  section_key text references public.sections(key),
  element_key text references public.elements(key),
  parent_item_id bigint references public.items(id),
  planned_seconds integer check (planned_seconds is null or planned_seconds >= 0),
  is_rollup_child boolean not null default false,
  resolution_source text not null default 'unmapped'
    check (resolution_source in ('unmapped', 'alias', 'manual', 'structural')),
  seen_in_last_pull boolean not null default true,
  pulled_at timestamptz not null default now(),
  check (parent_item_id is null or parent_item_id <> id),
  unique (plan_id, sequence, pco_item_id)
);

-- One-item bucket changes override aliases without changing shared history.
create table public.item_bucket_overrides (
  id bigint primary key generated always as identity,
  item_id bigint not null references public.items(id),
  section_key text not null references public.sections(key),
  element_key text not null references public.elements(key),
  created_at timestamptz not null default now(),
  created_by text not null,
  revoked_at timestamptz
);

create unique index item_bucket_overrides_one_active
  on public.item_bucket_overrides(item_id)
  where revoked_at is null;

create table public.item_times (
  id bigint primary key generated always as identity,
  pco_item_time_id text not null unique,
  item_id bigint not null references public.items(id),
  plan_time_id bigint not null references public.plan_times(id),
  pco_length_seconds integer,
  length_offset_seconds integer,
  live_start_at timestamptz,
  live_end_at timestamptz,
  pco_exclude boolean not null default false,
  actual_seconds integer generated always as (
    case
      when live_start_at is not null and live_end_at is not null
        then extract(epoch from (live_end_at - live_start_at))::integer
      else null
    end
  ) stored,
  source_fingerprint text not null,
  pulled_at timestamptz not null default now(),
  unique (item_id, plan_time_id)
);

create table public.review_incidents (
  id bigint primary key generated always as identity,
  plan_time_id bigint not null references public.plan_times(id),
  kind text not null check (kind in (
    'slot_resolution',
    'missing_live_bounds',
    'zero_live_window',
    'zero_allotment',
    'timer_bleed',
    'missing_item_end',
    'bundle_overlap',
    'reconciliation_gap'
  )),
  status text not null default 'open'
    check (status in ('open', 'kept', 'corrected', 'excluded')),
  source_fingerprint text not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status <> 'open' and resolved_at is not null and resolved_by is not null)
  )
);

create unique index review_incidents_one_open_source_kind
  on public.review_incidents(plan_time_id, kind, source_fingerprint)
  where status = 'open';

create table public.review_incident_items (
  incident_id bigint not null references public.review_incidents(id),
  item_id bigint not null references public.items(id),
  item_time_id bigint references public.item_times(id),
  primary key (incident_id, item_id),
  unique (incident_id, item_time_id)
);

-- A correction set is one atomic Admin save. Revisions preserve undo history.
create table public.correction_sets (
  id bigint primary key generated always as identity,
  incident_id bigint not null references public.review_incidents(id),
  revision integer not null check (revision > 0),
  status text not null default 'active'
    check (status in ('active', 'superseded', 'reverted')),
  created_at timestamptz not null default now(),
  created_by text not null,
  status_changed_at timestamptz,
  unique (incident_id, revision)
);

create unique index correction_sets_one_active_revision
  on public.correction_sets(incident_id)
  where status = 'active';

create table public.correction_values (
  id bigint primary key generated always as identity,
  correction_set_id bigint not null references public.correction_sets(id),
  plan_time_id bigint references public.plan_times(id),
  item_id bigint references public.items(id),
  item_time_id bigint references public.item_times(id),
  corrected_planned_seconds integer,
  corrected_actual_seconds integer,
  check (num_nonnulls(plan_time_id, item_id, item_time_id) = 1),
  check (
    corrected_planned_seconds is not null
    or corrected_actual_seconds is not null
  ),
  check (corrected_planned_seconds is null or corrected_planned_seconds >= 0),
  check (corrected_actual_seconds is null or corrected_actual_seconds >= 0),
  check (
    (plan_time_id is not null)
    or (item_id is not null
        and corrected_planned_seconds is not null
        and corrected_actual_seconds is null)
    or (item_time_id is not null
        and corrected_actual_seconds is not null
        and corrected_planned_seconds is null)
  )
);

create unique index correction_values_plan_time_once
  on public.correction_values(correction_set_id, plan_time_id)
  where plan_time_id is not null;

create unique index correction_values_item_once
  on public.correction_values(correction_set_id, item_id)
  where item_id is not null;

create unique index correction_values_item_time_once
  on public.correction_values(correction_set_id, item_time_id)
  where item_time_id is not null;

create table public.ingest_runs (
  id bigint primary key generated always as identity,
  kind text not null check (kind in ('actuals', 'plans', 'manual', 'backfill')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'ok', 'partial', 'failed')),
  window_start date,
  window_end date,
  plans_upserted integer not null default 0 check (plans_upserted >= 0),
  items_upserted integer not null default 0 check (items_upserted >= 0),
  unmapped_count integer not null default 0 check (unmapped_count >= 0),
  error text,
  check (window_end is null or window_start is null or window_end >= window_start),
  check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

create table public.plan_changes (
  id bigint primary key generated always as identity,
  campus_id bigint not null references public.campuses(id),
  slot_id bigint not null references public.service_slots(id),
  element_key text not null references public.elements(key),
  from_seconds integer check (from_seconds is null or from_seconds >= 0),
  to_seconds integer not null check (to_seconds >= 0),
  source text not null default 'recommendation'
    check (source in ('recommendation', 'manual')),
  status text not null default 'open'
    check (status in ('open', 'applied', 'dismissed')),
  evidence jsonb not null default '{}'::jsonb,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  applied_at timestamptz
);

create unique index plan_changes_one_open_element
  on public.plan_changes(campus_id, slot_id, element_key)
  where status = 'open';

create table public.admin_audit_log (
  id bigint primary key generated always as identity,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only';
end;
$$;

create trigger admin_audit_log_append_only
before update or delete on public.admin_audit_log
for each row execute function public.prevent_audit_mutation();

create index plans_campus_service_date
  on public.plans(campus_id, service_date desc);
create index plan_times_plan_id on public.plan_times(plan_id);
create index plan_times_detected_slot_id on public.plan_times(detected_slot_id);
create index items_plan_sequence on public.items(plan_id, sequence);
create index items_element_key on public.items(element_key);
create index item_times_plan_time_id on public.item_times(plan_time_id);
create index review_incidents_status on public.review_incidents(status, opened_at);
create index ingest_runs_started_at on public.ingest_runs(started_at desc);

create view public.unmapped_items
with (security_invoker = true)
as
select
  i.id,
  c.code as campus,
  p.service_date,
  i.raw_title,
  i.item_type,
  i.section_key,
  i.planned_seconds
from public.items i
join public.plans p on p.id = i.plan_id
join public.campuses c on c.id = p.campus_id
left join public.item_bucket_overrides o
  on o.item_id = i.id and o.revoked_at is null
where coalesce(o.element_key, i.element_key) is null
  and i.is_rollup_child = false
  and i.item_type in ('item', 'media', 'song')
  and coalesce(i.planned_seconds, 0) > 0;

create view public.effective_plan_times
with (security_invoker = true)
as
select
  pt.*,
  case
    when r.action = 'exclude' then null
    when r.action = 'map' then r.slot_id
    else pt.detected_slot_id
  end as effective_slot_id,
  (r.action = 'exclude') as is_manually_excluded
from public.plan_times pt
left join public.plan_time_slot_resolutions r
  on r.plan_time_id = pt.id and r.superseded_at is null;

comment on table public.plan_times is
  'Immutable PCO PlanTime evidence plus deterministic detected slot; manual decisions live separately.';
comment on table public.correction_sets is
  'Revisioned, occurrence-only database overlays. Never written to Planning Center.';
comment on table public.admin_audit_log is
  'Append-only operator audit trail. There is intentionally no reason field.';

-- Public schema tables are server-only until explicit read APIs and auth policy ship.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'campuses', 'service_slots', 'sections', 'elements', 'element_redirects',
    'section_aliases', 'element_aliases', 'plans', 'plan_times',
    'plan_time_slot_resolutions', 'items', 'item_bucket_overrides',
    'item_times', 'review_incidents', 'review_incident_items',
    'correction_sets', 'correction_values', 'ingest_runs', 'plan_changes',
    'admin_audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('revoke all on table public.%I from anon, authenticated', relation_name);
    execute format('grant all on table public.%I to service_role', relation_name);
  end loop;
end $$;

revoke all on table public.unmapped_items from anon, authenticated;
revoke all on table public.effective_plan_times from anon, authenticated;
grant select on table public.unmapped_items to service_role;
grant select on table public.effective_plan_times to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on function public.prevent_audit_mutation() from public, anon, authenticated;

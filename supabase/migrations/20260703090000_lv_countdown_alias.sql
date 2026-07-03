-- LV names its countdown "5 Minute Countdown" (41 backfilled weeks) — the
-- single biggest driver of LV's sub-95% mapped share in backfill_quality.

insert into public.element_aliases
  (section_key, raw_title_normalized, match_type, priority, element_key)
values
  ('pre_service', '5 minute countdown', 'exact', 10, 'pre.countdown')
on conflict (campus_id, section_key, raw_title_normalized, match_type) do update set
  priority = excluded.priority,
  element_key = excluded.element_key;

insert into public.elements
  (key, section_key, display_name, is_tracked, is_lever_eligible, applies_to_campuses, sort_order)
values
  ('worship.communion', 'worship_open', 'Communion (in Worship)', true, true, null, 30)
on conflict (key) do update set
  section_key = excluded.section_key,
  display_name = excluded.display_name,
  is_tracked = excluded.is_tracked,
  is_lever_eligible = excluded.is_lever_eligible,
  applies_to_campuses = excluded.applies_to_campuses,
  sort_order = excluded.sort_order;

insert into public.element_aliases
  (section_key, raw_title_normalized, match_type, priority, element_key)
values
  ('worship_open', 'communion', 'exact', 10, 'worship.communion')
on conflict (campus_id, section_key, raw_title_normalized, match_type) do update set
  priority = excluded.priority,
  element_key = excluded.element_key;

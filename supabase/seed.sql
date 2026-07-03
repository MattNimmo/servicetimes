-- Deterministic configuration only. No production timing data belongs in seeds.

insert into public.campuses
  (code, name, pco_service_type_id, is_broadcast_origin)
values
  ('ELK', 'Elk River', '650973', false),
  ('LV', 'Lakeville', '1176051', false),
  ('MG', 'Maple Grove', '380440', false),
  ('SLP', 'Spring Lake Park', '31424', true)
on conflict (code) do update set
  name = excluded.name,
  pco_service_type_id = excluded.pco_service_type_id,
  is_broadcast_origin = excluded.is_broadcast_origin;

insert into public.service_slots
  (campus_id, slot_label, expected_local_start)
values
  ((select id from public.campuses where code = 'ELK'), '9am', '09:00'),
  ((select id from public.campuses where code = 'ELK'), '11am', '11:00'),
  ((select id from public.campuses where code = 'LV'), '10am', '10:00'),
  ((select id from public.campuses where code = 'MG'), '9am', '09:00'),
  ((select id from public.campuses where code = 'MG'), '11am', '11:00'),
  ((select id from public.campuses where code = 'SLP'), '9am', '09:00'),
  ((select id from public.campuses where code = 'SLP'), '11am', '11:00')
on conflict (campus_id, slot_label) do update set
  expected_local_start = excluded.expected_local_start,
  is_active = true;

insert into public.sections
  (key, display_name, sort_order, is_analytics_eligible)
values
  ('pre_service', 'Pre-Service', 10, false),
  ('worship_open', 'Worship', 20, true),
  ('mid_service', 'Mid Service', 30, true),
  ('live', 'Live', 40, true),
  ('local', 'Local', 50, true),
  ('post_service', 'Post-Service', 60, false)
on conflict (key) do update set
  display_name = excluded.display_name,
  sort_order = excluded.sort_order,
  is_analytics_eligible = excluded.is_analytics_eligible;

insert into public.elements
  (key, section_key, display_name, is_tracked, is_lever_eligible, applies_to_campuses, sort_order)
values
  ('pre.countdown', 'pre_service', 'Countdown Video', true, false, null, 10),
  ('worship.open', 'worship_open', 'Praise & Worship', true, true, null, 10),
  ('worship.communion', 'worship_open', 'Communion (in Worship)', true, true, null, 30),
  ('mid.close_worship', 'mid_service', 'Close Worship', true, true, null, 10),
  ('mid.connect_card', 'mid_service', 'Connect Card', true, true, null, 20),
  ('mid.greet', 'mid_service', 'Greet & Seat', true, true, null, 30),
  ('mid.announcements', 'mid_service', 'Announcements', false, true, null, 40),
  ('mid.offering', 'mid_service', 'Offering', false, true, null, 70),
  ('mid.hosted_moment', 'mid_service', 'Hosted Moment', true, true, null, 100),
  ('mid.communion', 'mid_service', 'Communion', true, true, null, 110),
  ('mid.5spot', 'mid_service', '5 Spot', true, true, array['LV'], 120),
  ('live.bumper', 'live', 'Bumper', true, true, null, 10),
  ('live.message', 'live', 'Message', true, false, null, 20),
  ('local.worship_response', 'local', 'Worship Response', true, true, null, 10),
  ('local.salvation', 'local', 'Salvation Response', true, true, null, 20),
  ('local.final_prayer', 'local', 'Final Prayer', true, true, null, 30)
on conflict (key) do update set
  section_key = excluded.section_key,
  display_name = excluded.display_name,
  is_tracked = excluded.is_tracked,
  is_lever_eligible = excluded.is_lever_eligible,
  applies_to_campuses = excluded.applies_to_campuses,
  sort_order = excluded.sort_order;

insert into public.elements
  (key, parent_key, section_key, display_name, is_tracked, is_lever_eligible, sort_order)
values
  ('mid.announcements.general', 'mid.announcements', 'mid_service', 'Announcements', true, true, 50),
  ('mid.announcements.pre_offering', 'mid.announcements', 'mid_service', 'Pre-Offering Announcements', true, true, 60),
  ('mid.offering.general', 'mid.offering', 'mid_service', 'Offering', true, true, 80),
  ('mid.offering.campaign', 'mid.offering', 'mid_service', 'Campaign Offering', true, true, 90)
on conflict (key) do update set
  parent_key = excluded.parent_key,
  section_key = excluded.section_key,
  display_name = excluded.display_name,
  is_tracked = excluded.is_tracked,
  is_lever_eligible = excluded.is_lever_eligible,
  sort_order = excluded.sort_order;

insert into public.section_aliases
  (raw_title_normalized, match_type, priority, section_key)
values
  ('pre service', 'exact', 10, 'pre_service'),
  ('^praise (&|and) worship$', 'regex', 20, 'worship_open'),
  ('^mid[- ]?service$', 'regex', 30, 'mid_service'),
  ('^live( stream| time| message.*)?$', 'regex', 40, 'live'),
  ('^(local|local response|location disconnect|live response)$', 'regex', 50, 'local'),
  ('online disconnect', 'exact', 60, 'post_service')
on conflict (campus_id, raw_title_normalized, match_type) do update set
  priority = excluded.priority,
  section_key = excluded.section_key;

insert into public.element_aliases
  (section_key, raw_title_normalized, match_type, priority, element_key)
values
  ('pre_service', 'countdown video', 'exact', 10, 'pre.countdown'),
  ('worship_open', 'worship bundle', 'exact', 10, 'worship.open'),
  ('worship_open', 'musical worship bundle', 'exact', 10, 'worship.open'),
  ('worship_open', 'communion', 'exact', 10, 'worship.communion'),
  ('mid_service', 'close worship', 'exact', 10, 'mid.close_worship'),
  ('mid_service', 'greet and seat', 'exact', 10, 'mid.greet'),
  ('mid_service', 'meet & greet', 'exact', 10, 'mid.greet'),
  ('mid_service', 'announcements', 'exact', 10, 'mid.announcements.general'),
  ('mid_service', 'offering', 'exact', 10, 'mid.offering.general'),
  ('mid_service', 'hosted moment', 'exact', 10, 'mid.hosted_moment'),
  ('live', 'bumper', 'exact', 10, 'live.bumper'),
  ('live', 'bumper video', 'exact', 10, 'live.bumper'),
  ('live', 'message', 'exact', 10, 'live.message'),
  ('local', 'worship response', 'exact', 10, 'local.worship_response'),
  ('local', 'worship response song', 'exact', 10, 'local.worship_response'),
  ('local', 'salvation response', 'exact', 10, 'local.salvation'),
  ('local', 'final prayer', 'exact', 10, 'local.final_prayer'),
  ('local', 'closing prayer', 'exact', 10, 'local.final_prayer')
on conflict (campus_id, section_key, raw_title_normalized, match_type) do update set
  priority = excluded.priority,
  element_key = excluded.element_key;

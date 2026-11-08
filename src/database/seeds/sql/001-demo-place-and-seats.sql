-- Demo place, policy, opening hours, areas and seats.
-- Lets the bookings module be tested before the places/areas/seats modules exist.
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING, safe to run any number of times.

-- Place ----------------------------------------------------------------------
INSERT INTO places (id, name, type, description, address, lat, lng, timezone)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Demo Library',
  'LIBRARY',
  'Seeded demo place for local development.',
  'Street 1, Phnom Penh',
  11.5564, 104.9282,
  'Asia/Phnom_Penh'
)
ON CONFLICT (id) DO NOTHING;

-- Policy: defaults from docs/erd.md, except max_active_per_user so a user can
-- book several seats at once (multi-seat booking).
INSERT INTO booking_policies (
  place_id, checkin_grace_minutes, late_checkin_alert_minutes,
  checkout_reminder_minutes, overdue_alert_minutes,
  min_minutes, max_minutes, slot_minutes, max_advance_days,
  max_active_per_user, max_extensions, modify_cutoff_minutes
)
VALUES (
  '11111111-1111-4111-8111-111111111111', 15, 5,
  15, 15,
  30, 240, 15, 7,
  5, 2, 30
)
ON CONFLICT (place_id) DO NOTHING;

-- Opening hours: every day 07:00-22:00 (0 = Sunday .. 6 = Saturday), place's local time.
INSERT INTO place_opening_hours (place_id, weekday, open_time, close_time)
SELECT '11111111-1111-4111-8111-111111111111', d, '07:00', '22:00'
FROM generate_series(0, 6) AS d
ON CONFLICT (place_id, weekday) DO NOTHING;

-- Areas ------------------------------------------------------------------------
INSERT INTO areas (id, place_id, name, floor, description)
VALUES
  ('22222222-2222-4222-8222-22222222000a', '11111111-1111-4111-8111-111111111111',
   'Quiet Zone', '1', 'Silent study area'),
  ('22222222-2222-4222-8222-22222222000b', '11111111-1111-4111-8111-111111111111',
   'Group Zone', '2', 'Talking allowed')
ON CONFLICT (id) DO NOTHING;

-- Seats: A1-A5 in the quiet zone, B1-B5 in the group zone. B5 is under
-- maintenance so "seat not bookable" can be tested.
INSERT INTO seats (id, place_id, area_id, label, features, status)
VALUES
  ('33333333-3333-4333-8333-3333333300a1', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000a', 'A1', '{"power": true,  "window": true}',  'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300a2', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000a', 'A2', '{"power": true,  "window": false}', 'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300a3', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000a', 'A3', '{"power": false, "window": true}',  'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300a4', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000a', 'A4', '{"power": false, "window": false}', 'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300a5', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000a', 'A5', '{"power": true,  "desk": "large"}',  'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300b1', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000b', 'B1', '{"power": true}',  'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300b2', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000b', 'B2', '{"power": true}',  'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300b3', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000b', 'B3', '{"power": false}', 'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300b4', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000b', 'B4', '{"power": false}', 'ACTIVE'),
  ('33333333-3333-4333-8333-3333333300b5', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-22222222000b', 'B5', '{"power": true}',  'MAINTENANCE')
ON CONFLICT (id) DO NOTHING;

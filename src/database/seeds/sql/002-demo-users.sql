-- Demo accounts for local development. Sign in through POST /auth/login.
--   superadmin@demo.local / SuperAdmin@12345 (SUPER_ADMIN)
--   admin@demo.local  / Admin@12345   (ADMIN)
--   user@demo.local   / User@12345    (USER)
--   user2@demo.local  / User@12345    (USER, for "someone else's booking" tests)
-- Local demo passwords only: the seed runner refuses to run in production.
--
-- crypt(..., gen_salt('bf', 10)) is pgcrypto's bcrypt ($2a$), which the auth
-- module's bcrypt.compare accepts. Fixed ids, so bookings tests can refer to them.
-- ON CONFLICT: also gives a password to these accounts if an older seed created
-- them without one; never overwrites a password that was changed.

INSERT INTO users (id, role_id, name, email, password_hash, email_verified_at)
VALUES
  ('44444444-4444-4444-8444-000000000000', (SELECT id FROM roles WHERE name = 'SUPER_ADMIN'), 'Demo Super Admin', 'superadmin@demo.local',
   crypt('SuperAdmin@12345', gen_salt('bf', 10)), now()),
  ('44444444-4444-4444-8444-000000000001', (SELECT id FROM roles WHERE name = 'ADMIN'), 'Demo Admin',  'admin@demo.local',
   crypt('Admin@12345', gen_salt('bf', 10)), now()),
  ('44444444-4444-4444-8444-000000000002', (SELECT id FROM roles WHERE name = 'USER'),  'Demo User',   'user@demo.local',
   crypt('User@12345', gen_salt('bf', 10)), now()),
  ('44444444-4444-4444-8444-000000000003', (SELECT id FROM roles WHERE name = 'USER'),  'Demo User 2', 'user2@demo.local',
   crypt('User@12345', gen_salt('bf', 10)), now())
ON CONFLICT (id) DO UPDATE
  SET password_hash = EXCLUDED.password_hash
  WHERE users.password_hash IS NULL;

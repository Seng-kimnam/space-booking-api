-- Local development bootstrap account for approving admin registrations.
--   superadmin@demo.local / SuperAdmin@12345
-- The seed runner refuses to run in production.

INSERT INTO users (id, role_id, name, email, password_hash, email_verified_at)
VALUES (
  '44444444-4444-4444-8444-000000000000',
  (SELECT id FROM roles WHERE name = 'SUPER_ADMIN'),
  'Demo Super Admin',
  'superadmin@demo.local',
  crypt('SuperAdmin@12345', gen_salt('bf', 10)),
  now()
)
ON CONFLICT (id) DO UPDATE
SET role_id = EXCLUDED.role_id,
    password_hash = CASE
      WHEN users.password_hash IS NULL THEN EXCLUDED.password_hash
      ELSE users.password_hash
    END,
    email_verified_at = COALESCE(users.email_verified_at, EXCLUDED.email_verified_at);

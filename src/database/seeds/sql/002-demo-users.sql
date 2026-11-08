-- Demo accounts for local development, used with the TEMPORARY dev login
-- (src/dev/dev-auth.guard.ts): Authorization: Bearer <id>.
-- No password: they can't sign in through the real auth flow. Idempotent.

INSERT INTO users (id, role, name, email, email_verified_at)
VALUES
  ('44444444-4444-4444-8444-000000000001', 'ADMIN', 'Demo Admin', 'admin@demo.local', now()),
  ('44444444-4444-4444-8444-000000000002', 'USER',  'Demo User',  'user@demo.local',  now()),
  ('44444444-4444-4444-8444-000000000003', 'USER',  'Demo User 2', 'user2@demo.local', now())
ON CONFLICT (id) DO NOTHING;

/**
 * Jest e2e setup (test/jest-e2e.json "setupFiles"): runs before each test file.
 *
 * 1. Loads `.env` first, so a local setup keeps its own DB_* and secrets
 *    (dotenv never overwrites variables that are already set, e.g. by CI).
 * 2. Fills in test-safe defaults for anything still missing, so CI runs
 *    without a `.env`. Placeholder OAuth ids only satisfy the passport
 *    strategies' getOrThrow at startup; no test calls the providers.
 * 3. Refuses to run against a database whose name doesn't end in `_test`:
 *    e2e tests write and clean up rows (AGENTS.md section 4).
 */
import { config } from 'dotenv';

config({ quiet: true });

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  // No password in the repo: set DB_PASSWORD in .env locally; CI uses trust auth.
  DB_PASSWORD: '',
  DB_NAME: 'space_booking_db_test',
  JWT_SECRET: 'e2e-only-jwt-secret-not-for-production-use',
  // Empty = RabbitMQ disabled: the outbox relay and consumers stay idle.
  RABBITMQ_URL: '',
  GOOGLE_CLIENT_ID: 'e2e-google-client-id',
  GOOGLE_CLIENT_SECRET: 'e2e-google-client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/google/callback',
  FACEBOOK_APP_ID: 'e2e-facebook-app-id',
  FACEBOOK_APP_SECRET: 'e2e-facebook-app-secret',
  FACEBOOK_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/facebook/callback',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

if (!process.env.DB_NAME?.endsWith('_test')) {
  throw new Error(
    'e2e tests must run against a *_test database (set DB_NAME=<name>_test)',
  );
}

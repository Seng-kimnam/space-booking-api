# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working in this repository. Read it fully before making changes. Humans: this is also our team's working agreement.

## 1. Project overview

**Online Space Booking System, backend API only.** Students and workers browse places (libraries, cafes, coworking), see live seat availability, reserve a seat before arriving, check in with a one-time QR code, and get Telegram alerts about their booking. This repo contains only the REST API. There is no frontend here.

**Independent backend.** This app does not depend on any other system (e.g. a Library Management System). Other apps integrate with it **synchronously** over the REST API (as `api_clients`) and **asynchronously** over RabbitMQ (events published via the transactional outbox, consumed messages deduplicated via the inbox). See `docs/decisions/0001-independent-backend-integration.md`.

**Roles** (only these two)
- `ADMIN`: manages places, areas, seats, policies, bookings, API clients; monitors occupancy; manual check-in/out.
- `USER`: browses, books, modifies, extends, cancels, checks in/out by QR, links Telegram.

**Core features**: auth (register, email OTP verification, login, refresh, logout, forgot/reset password by email OTP); browse places, areas, seats and availability; reserve, modify, extend, cancel with no double-booking; one-time QR check-in/check-out; auto-expire after the grace period; overdue checkout detection; Telegram linking and booking alerts; admin monitoring. Full list: `docs/api-endpoints.md`.

**Team**: 4 to 5 developers working in parallel. Keep changes small and scoped so we don't collide.

## 2. Tech stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js, TypeScript (`strict`) |
| Framework | NestJS |
| Database | PostgreSQL (extensions `btree_gist`, `citext`, `pgcrypto` required) |
| ORM / migrations | TypeORM, **migrations only** (`synchronize: false` always) |
| Auth | JWT access token + rotating refresh token, password hashing with argon2 or bcrypt; social sign-in with Google and Facebook (OAuth redirect + callback with PKCE for web, provider-token flow for mobile); API keys for `api_clients` |
| Validation | `class-validator` + `class-transformer` DTOs |
| Scheduling | `@nestjs/schedule` (or BullMQ) for background jobs |
| Messaging | RabbitMQ (topic exchange `space-booking.events`), transactional outbox/inbox |
| Notifications | Email (auth OTP only, Mailpit locally), Telegram Bot API (booking alerts) |
| API docs | `@nestjs/swagger` (OpenAPI) |
| Tests | Jest, Supertest |
| Infra | Docker, Docker Compose, CI via GitHub Actions |

> If the team changes any of these, update this table in the same PR.

## 3. Repository layout

Full module map (table ownership, endpoints, exports, dependency graph, in-module layout): **`docs/project-structure.md`**.

```
/src
  main.ts, app.module.ts
  /configuration   # registerAs configs + env validation
  /logger
  /database        # data-source.ts, /migrations, /seeds, /transformers
  /common          # enums, decorators, guards, filters, interceptors, shared DTOs, utils
  /redis           # global ioredis provider
  /health
  /users           # users, user_otps
  /auth            # register, OTP, login, refresh, Google/Facebook OAuth, identities
  /places          # places, opening hours, closures, booking policies
  /areas
  /seats
  /bookings        # bookings, history, QR check-in/out, availability
  /telegram        # account linking, bot client, webhook
  /notifications   # email + Telegram channels, dispatcher
  /api-clients     # API keys for integrating apps
  /messaging       # RabbitMQ, outbox, inbox, consumers
  /admin           # dashboard, occupancy, monitoring
  /jobs            # expire, overdue, notification dispatch, outbox relay
/test              # e2e/<module>/*.e2e-spec.ts, utils/
/docs              # erd.md, api-endpoints.md, project-structure.md, decisions/
/infrastructure    # docker compose (development, production), monitoring
.env.example
AGENTS.md
```

One NestJS module per domain folder. Keep this section and `docs/project-structure.md` accurate.

## 4. Commands

Use these; do not invent alternatives. Adjust to the real `package.json` scripts.

```bash
# setup
npm install
cp .env.example .env
docker compose up -d db

# run
npm run start:dev

# database / migrations (TypeORM)
npm run migration:generate -- src/database/migrations/<Name>
npm run migration:create   -- src/database/migrations/<Name>   # empty, for raw SQL
npm run migration:run
npm run migration:revert                                       # local dev DB only
npm run seed

# quality gate (must pass before every commit/PR)
npm run lint && npm run build && npm test && npm run test:e2e
```

If a command above doesn't exist yet, say so and propose adding it. Don't silently substitute.

## 5. Data model (19 tables)

`docs/erd.md` is the full schema (columns, constraints, indexes). Do not add tables without team agreement and an ERD update.

```
roles, users, auth_identities, user_otps, refresh_tokens            -- auth
places, place_opening_hours, place_closures, booking_policies,     -- places & seats
  areas, seats
bookings, booking_events, booking_qr_tokens                         -- bookings
telegram_accounts, notifications                                    -- notifications
api_clients, outbox_events, inbox_events                            -- integration
```

- `users.role_id` references `roles.id`; seeded roles are `SUPER_ADMIN | ADMIN | USER`, and `USER` is the default for new users.
- `users.password_hash` is NULL for users who only sign in with Google/Facebook. Social accounts live in `auth_identities`, matched on `(provider, provider_user_id)`, never on email. Provider tokens are not stored.
- Booking `status`: `PENDING | CHECKED_IN | CHECKOUT_OVERDUE | COMPLETED | CANCELLED | EXPIRED`.
- Booking `source`: `APP | API_CLIENT | ADMIN`. `bookings.user_id` is always set (no walk-ins).
- Grace period, reminder offsets and booking limits come from `booking_policies` (one row per place). Never hardcode "15 minutes".
- OTPs (email verify, password reset, Telegram link) live in `user_otps`; QR codes in `booking_qr_tokens`. Both store hashes only and are single use.
- Notification `channel`: `EMAIL` (auth OTP only) or `TELEGRAM` (booking alerts).
- Seats belong to a place and optionally an area (`areas` table).
- Places, areas and seats are soft-deleted (`deleted_at`).
- UUID primary keys for all tables.

## 6. Critical domain rules (never violate)

1. **No double-booking is enforced by the database, not application code.**
   Add this in a migration (TypeORM can't express it in entity decorators, so use raw SQL):
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;

   ALTER TABLE bookings ADD CONSTRAINT no_double_booking
     EXCLUDE USING gist (seat_id WITH =, time_range WITH &&)
     WHERE (status IN ('PENDING', 'CHECKED_IN', 'CHECKOUT_OVERDUE'));
   ```
   Never replace it with "check availability, then insert". It also guards modify and extend (UPDATEs of `time_range`). Catch Postgres error code `23P01` (exclusion violation) in the booking service and return `409 Conflict`.
2. **Seat availability is derived, never stored.** No `is_available` column. A seat is available for a range if it is `ACTIVE`, not deleted, the place is open for the whole range, and no `PENDING`/`CHECKED_IN`/`CHECKOUT_OVERDUE` booking overlaps it. A seat with a `CHECKOUT_OVERDUE` booking counts as occupied *now* until an admin resolves it.
3. **One-time QR.** Check-in/out QR tokens are single use, hash-only, revoked when reissued, and marked used in the same transaction as the status change. Admins can check in/out manually.
4. **Expiry is automatic.** A `PENDING` booking not checked in within `booking_policies.checkin_grace_minutes` of its start becomes `EXPIRED`, increments `users.no_show_count`, and frees the seat. A `CHECKED_IN` booking past its end becomes `CHECKOUT_OVERDUE`. Both are scheduled jobs, never done lazily on read.
5. **"Nearly timed out" is computed** from `upper(time_range) - now()` for `CHECKED_IN` bookings. Do not add a column for it.
6. **Time is `timestamptz`, stored in UTC.** Convert to `places.timezone` only when formatting output. Reject bookings outside `place_opening_hours` or on `place_closures` (evaluated in the place's timezone) and bookings in the past.
7. **Authorization is enforced server-side.** Never trust a role, user id or client id from the request body; use the authenticated user or API client. Users may only view, modify or cancel their own bookings. API clients are limited to their `scopes`.
8. **OTPs and tokens** (email OTP, refresh, QR, Telegram link, API keys): store only a hash, with expiry, single use where applicable. Never log or return a stored token. Respond identically whether or not the email exists (no account enumeration).
9. **Passwords** are hashed (argon2/bcrypt). Never log, return, or commit passwords, hashes, tokens, or secrets. Exclude `password_hash` and token fields from every response and every event payload.
10. **Cancelling** sets `status = CANCELLED`, `cancelled_at` and `cancelled_by`; it never deletes the row. Cancelled slots become bookable again automatically through the constraint's `WHERE` clause.
11. **Booking changes run in one transaction** with their `booking_events` row, their `notifications` rows and their `outbox_events` row. Never publish to RabbitMQ directly from a request handler; the outbox relay does it.
12. **Consumers are idempotent.** Every consumed message (RabbitMQ, Telegram webhook) is recorded in `inbox_events` keyed by `(source, message_id)` before it is processed.
13. **Social sign-in never trusts an unverified email.** Verify every provider token server-side (Google: signature, `aud`, `iss`, `exp`; Facebook: `debug_token` with our app id). The callback validates a single-use `state` and only redirects to an allowlisted `redirect_uri`; it returns a one-time login code, never tokens, in the URL. Auto-link to an existing account only when the provider reports the email as verified; otherwise require the user to sign in and link explicitly. A user must always keep at least one sign-in method. Social sign-up only ever creates `USER`.

## 7. TypeORM and migration rules

- `synchronize` is **always `false`**, in every environment. Schema changes happen only through migrations.
- Never edit a migration that has been merged. Add a new one.
- Every migration must have a working `down()`. Test `run` then `revert` then `run` locally.
- Generate migrations from entity changes, then **read the generated SQL** before committing. Remove unrelated drift.
- Things TypeORM can't model (exclusion constraint, `tstzrange` quirks, `CHECK` constraints) go in hand-written SQL inside a migration (`queryRunner.query(...)`).
- The `CHECK` constraints tying booking status to its timestamps are listed in `docs/erd.md` section 5; enforce the same rules in the service layer too.
- Entities live next to their module (`*.entity.ts`). Use explicit `@Column({ name: '...' })` so DB columns stay `snake_case` while properties stay `camelCase`.
- `time_range` is a Postgres `tstzrange`. Map it with a custom column type or transformer, or write the insert and overlap queries with raw SQL or the query builder. Keep that logic in one place (the bookings repository).
- Use repositories or the query builder. Avoid raw SQL scattered in services, except in the cases above.
- Add the indexes listed in `docs/erd.md` section 6.
- Seed data (one admin, one demo place with opening hours and policy, an area, a few seats) goes in `/src/database/seeds` and is idempotent.

## 8. API conventions

- REST under `/api/v1`. Document every endpoint with Swagger decorators.
- Status codes: `201` create, `204` no body, `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict (double-booking, duplicate email).
- Validate every input with DTOs (`whitelist: true`, `forbidNonWhitelisted: true`). Never accept entities directly as request bodies.
- Return response DTOs, not raw entities, so internal fields never leak.
- Consistent error shape: `{ statusCode, message, error }` via a global exception filter.
- Paginate list endpoints (`page`, `limit`, with a max). No unbounded lists.
- Endpoint list: `docs/api-endpoints.md`. Admin routes live under `/admin/*`. Add new endpoints there first.
- `POST /bookings` accepts an `Idempotency-Key` header (stored in `bookings.idempotency_key`).
- The Telegram webhook verifies the secret header; API clients authenticate with an API key header, not JWT.
- Async events (RabbitMQ routing keys) are listed in `docs/api-endpoints.md` section 9. Changing a payload is a breaking API change: version it.

## 9. Coding conventions

- TypeScript `strict`. No `any` without a comment explaining why.
- Controllers stay thin (parse, authorize, delegate). Business logic lives in services. Data access lives in repositories.
- Role and ownership checks use Nest guards and decorators (`@Roles(...)`, an ownership or place-scope check). Do not scatter `if (user.role === ...)` through services.
- Names: `camelCase` variables and functions, `PascalCase` classes and types, `snake_case` DB columns, `kebab-case` file names.
- Config comes from environment variables via `@nestjs/config`, validated at startup. No hardcoded secrets or URLs.
- Don't add a dependency without checking the existing stack covers it. Mention new dependencies in the PR.
- Comment the *why*, not the *what*.

## 10. Testing requirements

- Unit tests for every new service method; integration (e2e) tests for every endpoint.
- Integration tests run against a real PostgreSQL (Docker), not mocks, because the exclusion constraint is the thing under test.
- **Concurrency test is mandatory** for booking creation: fire many simultaneous requests for the same seat and overlapping time, and assert exactly one succeeds and the rest return `409`.
- Concurrency also applies to modify and extend: two overlapping changes on the same seat, exactly one succeeds.
- Test: cancelled slot becomes bookable again; expire job releases the seat after the grace period; overdue job marks `CHECKOUT_OVERDUE` and the seat stays occupied until resolved; check-in outside the allowed window is rejected; a QR token cannot be used twice or after reissue.
- Test authorization: `USER` cannot see or change others' bookings; `USER` gets `403` on `/admin/*`; an API client gets `403` outside its scopes.
- Test OTP flows (verify email, forgot password): expired code rejected, used code rejected, too many attempts rejected, same response for unknown email.
- Test social sign-in (provider verification mocked at the HTTP boundary, DB real): new user created with `password_hash = NULL`; returning user matched by `provider_user_id`; verified email links to an existing account; unverified email matching an existing account returns `409`; invalid/expired/wrong-audience token returns `401`; unlinking the last sign-in method returns `409`; callback with missing/expired/reused `state` fails; non-allowlisted `redirect_uri` is rejected; a login code works only once.
- Test idempotency: a repeated `POST /bookings` with the same `Idempotency-Key` returns the same booking; a duplicate inbox message is processed once; every booking change writes an outbox row in the same transaction.
- Never skip, delete, or weaken a failing test to make it pass. Fix the cause or ask.

## 11. Git and PR workflow

- Branch from `main`: `feat/<area>-<short-desc>`, `fix/<area>-<short-desc>`.
- Conventional Commits: `feat(bookings): reject overlapping seat reservations`.
- Small, focused PRs. Describe what changed, why, and how it was tested.
- Never push to `main` directly or force-push shared branches.
- **One person owns schema changes at a time.** Coordinate before creating a migration so timestamps and ordering don't collide. Mention any migration in the PR title.
- Respect the module dependency graph in `docs/project-structure.md` §3: no circular imports, cross-module calls only through exported services. Changing the graph needs team agreement.
- Don't touch files outside your task's scope (migrations, CI config, `common/`) without saying so in the PR.

## 12. How agents should work here

**Before coding**
- Read the relevant module, its entity, and its tests. Match existing patterns.
- If a requirement is ambiguous or conflicts with section 6, stop and ask. Don't guess.
- For non-trivial changes, outline the plan first: files, migrations, risks.

**While coding**
- Make the smallest change that solves the problem. No drive-by refactors.
- Prefer editing existing files to creating new ones.
- Any schema change = entity + migration + `docs/` ERD update, together.

**Before finishing**
- Run the quality gate (section 4) and, if you changed the schema, run `migration:run`, `migration:revert`, `migration:run` locally.
- Report honestly: what you changed, what you ran, what passed or failed, and anything unverified. Never claim tests pass if you didn't run them.
- List follow-ups and known gaps instead of hiding them.

## 13. Do not

- Do not commit secrets, `.env`, tokens, or real user data. Use `.env.example` with placeholders.
- Do not enable `synchronize`, or edit the database schema by hand.
- Do not run destructive commands (`DROP`, `TRUNCATE`, `migration:revert`, `rm -rf`) on anything but a local dev database, and not without confirmation.
- Do not bypass the exclusion constraint, disable validation, or use `// @ts-ignore` to get past errors.
- Do not log passwords, tokens, emails, or full request bodies.
- Do not invent tables, endpoints, or env vars that aren't in this file or the docs; propose them first.
- Do not build frontend code in this repo.

## 14. Definition of done

- [ ] Works as specified and respects section 6.
- [ ] Lint, build, and all tests pass locally and in CI.
- [ ] New logic has tests (including concurrency for anything that books seats).
- [ ] Migration included, reversible, and reviewed; ERD in `docs/` updated.
- [ ] Swagger docs updated for changed endpoints.
- [ ] No secrets, debug code, or unrelated changes.
- [ ] PR description explains what, why, and how it was verified.
# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working in this repository. Read it fully before making changes. Humans: this is also our team's working agreement.

## 1. Project overview

**Online Space Booking System, backend API only.** Students and workers browse places (libraries, cafes, coworking), see live seat availability, reserve a seat before arriving, and get notified about their booking. This repo contains only the REST API. There is no frontend here.

**Roles**
- `ADMIN`: sees and manages all places.
- `MANAGER`: manages only their own place (`users.place_id`).
- `USER`: browses, books, cancels, receives notifications.

**Core features**: list places, list seats per place with availability, seats nearly timed out, booking notifications, reserve, cancel, no double-booking, auth (register, login, forgot/reset password), check-in, walk-in marking by place admins.

**Team**: 4 to 5 developers working in parallel. Keep changes small and scoped so we don't collide.

## 2. Tech stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js, TypeScript (`strict`) |
| Framework | NestJS |
| Database | PostgreSQL (extension `btree_gist` required) |
| ORM / migrations | TypeORM, **migrations only** (`synchronize: false` always) |
| Auth | JWT access token (+ refresh if added), password hashing with argon2 or bcrypt |
| Validation | `class-validator` + `class-transformer` DTOs |
| Scheduling | `@nestjs/schedule` (or BullMQ) for background jobs |
| API docs | `@nestjs/swagger` (OpenAPI) |
| Tests | Jest, Supertest |
| Infra | Docker, Docker Compose, CI via GitHub Actions |

> If the team changes any of these, update this table in the same PR.

## 3. Repository layout

```
/src
  /auth            # register, login, forgot/reset password,resend otp guards, strategies
  /users
  /roles
  /places
  /seats
  /bookings        # reserve, cancel, check-in, walk-in, availability queries
  /notifications
  /jobs            # scheduled tasks: no-show release, reminders, auto-complete
  /common          # filters, interceptors, decorators, shared DTOs, enums
  /database
    data-source.ts
    /migrations
    /seeds
/test              # e2e / integration tests
/docs              # ERD, decisions
docker-compose.yml
.env.example
AGENTS.md
```

Adjust to the real structure and keep this section accurate. One NestJS module per domain folder.

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

## 5. Data model (the six tables)

This is the full schema. Do not add tables without team agreement and an ERD update.

```
roles(id PK, name UK)                       -- SUPER_ADMIN | PLACE_ADMIN | USER
users(id PK, role_id FK, place_id FK NULL, name, email UK, password_hash,
      reset_token_hash, reset_token_expires_at, no_show_count, created_at)
places(id PK, name, type, address, lat, lng, open_time, close_time, timezone,
       checkin_grace_minutes, is_active)
seats(id PK, place_id FK, zone, label, features jsonb, status)   -- ACTIVE | MAINTENANCE
bookings(id PK, seat_id FK, user_id FK NULL, source, time_range tstzrange, status,
         checked_in_at, cancelled_at, created_at)
notifications(id PK, user_id FK, booking_id FK, type, scheduled_at, sent_at, read_at)
```

- `users.place_id` is set only for `PLACE_ADMIN`; it is `NULL` for `SUPER_ADMIN` and `USER`.
- `bookings.user_id` is `NULL` for walk-ins (`source = WALK_IN`).
- Booking `status`: `RESERVED | CHECKED_IN | COMPLETED | CANCELLED | NO_SHOW`.
- Booking `source`: `ONLINE | WALK_IN`.
- Notification `type`: `CONFIRMED | REMINDER | ENDING_SOON | CANCELLED | NO_SHOW`.
- Password reset lives on `users` (`reset_token_hash`, `reset_token_expires_at`). Clear both after use.
- Seat zones are a plain `seats.zone` string, not a table.
- Use UUID primary keys for all tables except `roles` (small integer id is fine).

## 6. Critical domain rules (never violate)

1. **No double-booking is enforced by the database, not application code.**
   Add this in a migration (TypeORM can't express it in entity decorators, so use raw SQL):
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;

   ALTER TABLE bookings ADD CONSTRAINT no_double_booking
     EXCLUDE USING gist (seat_id WITH =, time_range WITH &&)
     WHERE (status IN ('RESERVED', 'CHECKED_IN'));
   ```
   Never replace it with "check availability, then insert". Catch Postgres error code `23P01` (exclusion violation) in the booking service and return `409 Conflict`.
2. **Seat availability is derived, never stored.** No `is_available` column. A seat is available for a range if no `RESERVED`/`CHECKED_IN` booking overlaps it and the seat is `ACTIVE`.
3. **Walk-ins are bookings** with `source = WALK_IN` and `user_id = NULL`, so the same constraint protects the seat. Only a `PLACE_ADMIN` (for their place) or `SUPER_ADMIN` may create them.
4. **No-shows are released automatically.** A `RESERVED` booking not checked in within `places.checkin_grace_minutes` of its start becomes `NO_SHOW`, increments `users.no_show_count`, and frees the seat. This is a scheduled job, never done lazily on read.
5. **"Nearly timed out" is computed** from `upper(time_range) - now()` for `CHECKED_IN` bookings. Do not add a column for it.
6. **Time is `timestamptz`, stored in UTC.** Convert to `places.timezone` only when formatting output. Reject bookings outside `open_time`/`close_time` (evaluated in the place's timezone) and bookings in the past.
7. **Authorization is enforced server-side.** A `PLACE_ADMIN` may only read or modify data where `place.id === user.place_id`. Never trust a role or place id from the request body; use the authenticated user. Users may only view or cancel their own bookings.
8. **Reset tokens**: store only a hash, with expiry, single use. Never log or return a stored token. Respond identically whether or not the email exists (no account enumeration).
9. **Passwords** are hashed (argon2/bcrypt). Never log, return, or commit passwords, hashes, tokens, or secrets. Exclude `password_hash` and reset fields from every response.
10. **Cancelling** sets `status = CANCELLED` and `cancelled_at`; it never deletes the row. Cancelled slots become bookable again automatically through the constraint's `WHERE` clause.
11. **Booking creation runs in a transaction** that inserts the booking and its notification rows together.

## 7. TypeORM and migration rules

- `synchronize` is **always `false`**, in every environment. Schema changes happen only through migrations.
- Never edit a migration that has been merged. Add a new one.
- Every migration must have a working `down()`. Test `run` then `revert` then `run` locally.
- Generate migrations from entity changes, then **read the generated SQL** before committing. Remove unrelated drift.
- Things TypeORM can't model (exclusion constraint, `tstzrange` quirks, `CHECK` constraints) go in hand-written SQL inside a migration (`queryRunner.query(...)`).
- Suggested `CHECK`: `users.place_id IS NOT NULL` when the role is `PLACE_ADMIN`; enforce in the service layer too.
- Entities live next to their module (`*.entity.ts`). Use explicit `@Column({ name: '...' })` so DB columns stay `snake_case` while properties stay `camelCase`.
- `time_range` is a Postgres `tstzrange`. Map it with a custom column type or transformer, or write the insert and overlap queries with raw SQL or the query builder. Keep that logic in one place (the bookings repository).
- Use repositories or the query builder. Avoid raw SQL scattered in services, except in the cases above.
- Add indexes for common reads: `bookings(seat_id)`, `bookings(user_id)`, a GiST index on `time_range` (the exclusion constraint creates one), `seats(place_id)`, `notifications(user_id, read_at)`.
- Seed data (roles, one demo place, a few seats, a super admin) goes in `/src/database/seeds` and is idempotent.

## 8. API conventions

- REST under `/api/v1`. Document every endpoint with Swagger decorators.
- Status codes: `201` create, `204` no body, `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict (double-booking, duplicate email).
- Validate every input with DTOs (`whitelist: true`, `forbidNonWhitelisted: true`). Never accept entities directly as request bodies.
- Return response DTOs, not raw entities, so internal fields never leak.
- Consistent error shape: `{ statusCode, message, error }` via a global exception filter.
- Paginate list endpoints (`page`, `limit`, with a max). No unbounded lists.
- Suggested endpoints (confirm before adding):
  - Auth: `POST /auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`
  - Places: `GET /places`, `GET /places/:id`, plus admin create/update
  - Seats: `GET /places/:id/seats?from=&to=` (availability for a range), admin manage seats
  - Bookings: `POST /bookings`, `GET /bookings/me`, `PATCH /bookings/:id/cancel`, `PATCH /bookings/:id/check-in`, `POST /places/:id/walk-ins`, `PATCH /bookings/:id/release`
  - Notifications: `GET /notifications`, `PATCH /notifications/:id/read`

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
- Test: cancelled slot becomes bookable again; walk-in blocks online booking; no-show job releases the seat after the grace period; check-in outside the allowed window is rejected.
- Test authorization: `USER` cannot see others' bookings; `PLACE_ADMIN` gets `403` on another place's data.
- Test forgot-password: expired token rejected, used token rejected, same response for unknown email.
- Never skip, delete, or weaken a failing test to make it pass. Fix the cause or ask.

## 11. Git and PR workflow

- Branch from `main`: `feat/<area>-<short-desc>`, `fix/<area>-<short-desc>`.
- Conventional Commits: `feat(bookings): reject overlapping seat reservations`.
- Small, focused PRs. Describe what changed, why, and how it was tested.
- Never push to `main` directly or force-push shared branches.
- **One person owns schema changes at a time.** Coordinate before creating a migration so timestamps and ordering don't collide. Mention any migration in the PR title.
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
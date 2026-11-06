# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working in this repository. Read this fully before making changes. Humans: this is also our team's working agreement.

## 1. Project overview

**Online Space Booking System**: students and workers browse places (libraries, cafes, coworking), see live seat availability, reserve a seat before arriving, and get notified about their booking.

**Roles**
- `ADMIN`: sees and manages all places.
- `PLACE_ADMIN`: manages only the place(s) linked to them via `place_admins`.
- `USER`: browses, books, cancels, receives notifications.

**Core features**: view places, view seats per place, see seats nearly timed out, booking notifications, reserve, cancel, no double-booking, auth (register, login, forgot password).

**Team**: 4 to 5 developers working in parallel. Keep changes small and scoped so we don't collide.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript |
| Backend | NestJS, TypeScript |
| Database | PostgreSQL (with `btree_gist` extension) |
| ORM / migrations | TypeORM (schema changes via migrations only; raw SQL where needed) |
| Jobs | Scheduled worker (e.g. `@nestjs/schedule` or BullMQ) |
| Infra | Docker, Docker Compose, CI via GitHub Actions |

> Change the rows above if the team decides differently, and keep this table accurate.

## 3. Repository layout

```
/apps
  /web        # Next.js frontend
  /api        # NestJS backend
/packages
  /shared     # shared types, DTOs, enums (single source of truth)
/docs         # ERD, API contract (OpenAPI), decisions
docker-compose.yml
AGENTS.md
```

Adjust to the real structure. If you add a top-level folder, update this section.

## 4. Commands

Always use these; do not invent alternatives.

```bash
# install
pnpm install

# run everything locally (db + api + web)
docker compose up -d db
pnpm dev

# backend
pnpm --filter api start:dev
pnpm --filter api test            # unit tests
pnpm --filter api test:e2e        # integration tests (needs db)
pnpm --filter api migration:generate -- <Name>
pnpm --filter api migration:run

# frontend
pnpm --filter web dev
pnpm --filter web test

# quality gate (must pass before every commit/PR)
pnpm lint && pnpm typecheck && pnpm test
```

If a command above doesn't exist yet, say so and propose adding it; don't silently substitute.

## 5. Critical domain rules (never violate)

These are the heart of the system. Breaking them is a bug even if tests pass.

1. **No double-booking is enforced by the database, not application code.**
   `bookings` has an exclusion constraint over `(seat_id, time_range)` for active statuses (`RESERVED`, `CHECKED_IN`). Never replace it with a "check availability then insert" pattern. Always handle the constraint error (Postgres code `23P01`) and return `409 Conflict`.
2. **Seat availability is derived, never stored.** Do not add an `is_available` column to `seats`. Availability = no active booking overlapping the requested time.
3. **Walk-ins are bookings.** A person who sits down without the app is a `bookings` row with `source = WALK_IN` and `user_id = NULL`, so the same constraint protects the seat.
4. **No-shows are released automatically.** A `RESERVED` booking not checked in within `places.checkin_grace_minutes` becomes `NO_SHOW` and frees the seat. This runs in a background job, not on page load.
5. **Time is always `timestamptz` in UTC.** Convert to `places.timezone` only for display. Never store local times as strings.
6. **Authorization is enforced server-side.** A `PLACE_ADMIN` may only act on places linked in `place_admins`. Never trust the role or place id sent by the client without checking it against the authenticated user.
7. **Reset tokens**: store only a hash, with `expires_at` and single use (`used_at`). Never log or return a token after creation.
8. **Passwords** are hashed (argon2 or bcrypt). Never log, return, or commit them or any secret.

## 6. Data model

The ERD lives in `/docs/erd.md`. Core tables: `users`, `places`, `place_admins`, `zones`, `seats`, `bookings`, `notifications`, `password_reset_tokens`, `seat_reports`.

- Booking statuses: `RESERVED | CHECKED_IN | COMPLETED | CANCELLED | NO_SHOW`.
- "Nearly timed out" is computed from `upper(time_range) - now()`; do not add a column for it.
- Any schema change requires a migration and an ERD update in the same PR.
- Never edit a migration that has already been merged. Add a new one.

## 7. Coding conventions

- TypeScript `strict` mode. No `any` without a comment explaining why.
- Shared types, enums, and DTOs live in `packages/shared`. Do not duplicate them in `web` and `api`.
- Backend: one NestJS module per domain (`auth`, `places`, `seats`, `bookings`, `notifications`). Controllers stay thin; logic goes in services; DB access goes through repositories.
- Validate all input with DTOs and `class-validator`. Return consistent error shapes.
- Frontend: server components by default; client components only when interactivity is needed. Fetch through a single API client, not ad hoc `fetch` calls scattered in components.
- Names: `camelCase` for variables/functions, `PascalCase` for types/classes/components, `snake_case` for database columns, `kebab-case` for file names.
- Prefer small pure functions. Comment the *why*, not the *what*.
- Don't add a dependency without checking whether the existing stack already covers it. Mention any new dependency in the PR.

## 8. API conventions

- REST, versioned under `/api/v1`. The OpenAPI spec in `/docs` is the contract; update it when endpoints change.
- Status codes: `201` create, `204` no body, `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict (including double-booking).
- Paginate list endpoints. Never return unbounded lists.

## 9. Testing requirements

- Every new service method gets unit tests. Every new endpoint gets at least one integration test.
- **Concurrency test is mandatory** for anything touching booking creation: fire many simultaneous requests at the same seat and time and assert exactly one succeeds and the rest return `409`.
- Test the no-show job and the cancel flow (cancelled slots must become bookable again).
- Test authorization: a `PLACE_ADMIN` must get `403` on another place's data.
- Do not skip, delete, or weaken a failing test to make it pass. Fix the cause or ask.

## 10. Git and PR workflow

- Branch from `main`: `feat/<area>-<short-desc>`, `fix/<area>-<short-desc>`.
- Commit messages: Conventional Commits (`feat(bookings): reject overlapping seat reservations`).
- Keep PRs small and focused on one thing. Include what changed, why, and how it was tested.
- Never push directly to `main`. Never force-push shared branches.
- Do not touch files outside your task's scope (especially migrations, CI config, or `packages/shared`) without saying so in the PR.

## 11. How agents should work here

**Before coding**
- Read the relevant module and its tests first. Match existing patterns instead of introducing new ones.
- If requirements are ambiguous or conflict with section 5, stop and ask. Don't guess.
- For non-trivial changes, outline the plan (files to change, migrations needed, risks) before writing code.

**While coding**
- Make the smallest change that solves the problem. No drive-by refactors or reformatting of unrelated files.
- Prefer editing existing files to creating new ones.
- Keep generated code consistent with sections 5 to 9.

**Before finishing**
- Run the quality gate: `pnpm lint && pnpm typecheck && pnpm test`.
- Report honestly: what you changed, what you ran, what passed or failed, and anything you did not verify. Never claim tests pass if you didn't run them.
- List follow-ups or known gaps instead of hiding them.

## 12. Do not

- Do not commit secrets, `.env` files, tokens, or real user data. Use `.env.example` with placeholders.
- Do not run destructive commands (`DROP`, `TRUNCATE`, `migration:revert`, `rm -rf`) against anything but a local dev database, and never without confirmation.
- Do not bypass the database constraint, disable validation, or add `// @ts-ignore` to get around errors.
- Do not log personal data (emails, passwords, tokens) or full request bodies.
- Do not invent endpoints, tables, or env vars that aren't in the docs; propose them first.

## 13. Definition of done

A task is done when:
- [ ] It works as specified and respects the rules in section 5.
- [ ] Lint, typecheck, and tests pass locally and in CI.
- [ ] New logic has tests (including concurrency for bookings).
- [ ] Migrations and `/docs` (ERD, OpenAPI) are updated if the schema or API changed.
- [ ] No secrets, debug code, or unrelated changes are included.
- [ ] The PR description explains what, why, and how it was verified.
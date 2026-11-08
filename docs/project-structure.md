# Project Structure

How the NestJS app is split into modules, based on `docs/erd.md` (18 tables) and `docs/api-endpoints.md`. Keep this file in sync when you add a module, move a table, or change module dependencies.

Conventions recap (see AGENTS.md §9): one NestJS module per domain folder, `kebab-case` files, thin controllers, business logic in services, data access in repositories, entities next to their module (`*.entity.ts`, picked up by `src/database/data-source.ts`).

## 1. Top-level tree

```
src/
  main.ts
  app.module.ts
  configuration/         # existing; add auth, oauth, telegram, rabbitmq configs + env validation
  logger/                # existing
  database/              # existing data-source.ts, migrations/, seeds/; add transformers/
  common/                # cross-cutting, no business logic
  redis/                 # global ioredis provider (OAuth state, login codes, rate limits)
  health/                # GET /health (replaces app.controller)

  users/                 # users, user_otps
  auth/                  # login, register, JWT, refresh_tokens, auth_identities (Google/Facebook)
  places/                # places, place_opening_hours, place_closures, booking_policies
  areas/                 # areas
  seats/                 # seats
  bookings/              # bookings, booking_events, booking_qr_tokens, availability, QR check-in/out
  telegram/              # telegram_accounts, bot client, webhook
  notifications/         # notifications, email + Telegram channels, dispatcher
  api-clients/           # api_clients, API-key guard
  messaging/             # RabbitMQ, outbox_events, inbox_events, consumers
  admin/                 # dashboard, occupancy, monitoring (read-only queries)
  jobs/                  # scheduled jobs (expire, overdue, dispatch, outbox relay)
test/
  e2e/<module>/*.e2e-spec.ts
  utils/                 # app factory, DB reset, auth helpers, fixtures
```

## 2. Module ownership

| Module | Tables | Endpoints (docs/api-endpoints.md) | Exports |
|---|---|---|---|
| users | users, user_otps | none (profile is `/auth/me`) | `UsersService`, `OtpService` |
| auth | refresh_tokens, auth_identities | §1 all `/auth/*`, `/auth/oauth/*`, `/auth/identities/*` | nothing (the JWT strategy is registered here; guards live in `common/`) |
| places | places, place_opening_hours, place_closures, booking_policies | `/places`, `/places/:id`, `/admin/places/*` | `PlacesService`, `OpeningHoursService` (is the place open for a range, in its timezone), `BookingPoliciesService` |
| areas | areas | `/places/:id/areas`, `/admin/places/:id/areas`, `/admin/areas/*` | `AreasService` |
| seats | seats | `/seats`, `/seats/:id`, `/places/:id/seats`, `/admin/seats/:id*`, `/admin/places/:id/seats` (the `GET /admin/seats` list is admin's) | `SeatsService` |
| bookings | bookings, booking_events, booking_qr_tokens | §4 bookings, §5 QR, plus `/seats/available` and `/seats/:id/availability` | `BookingsService`, `BookingsRepository` (for jobs/admin) |
| telegram | telegram_accounts | `/telegram/*`, `/webhooks/telegram` | `TelegramBotClient`, `TelegramAccountsService` |
| notifications | notifications | none | `NotificationsService` (schedule / skip in a transaction) |
| api-clients | api_clients | `/admin/api-clients/*` | `ApiKeyGuard`, `ApiClientsService` |
| messaging | outbox_events, inbox_events | none | `OutboxService.add(manager, event)`, `InboxService.handleOnce(...)`, `RabbitPublisher` |
| admin | none (read-only) | §7 `/admin/dashboard`, `/admin/occupancy`, `/admin/bookings/active\|overdue\|no-shows`, `/admin/seats` | none |
| jobs | none | none | none |

**Why availability lives in `bookings`.** The availability endpoints are under `/seats/...`, but they live in `bookings` as `seat-availability.controller.ts`. They need the `tstzrange` overlap query, and AGENTS §7 keeps that logic in the bookings repository. `bookings` already imports `seats`, so putting them in `seats` would create a circular import.

## 3. Dependency graph (imports point one way, no cycles)

```
common, configuration, database, redis, logger   <- used by everyone
users
places <- areas <- seats
telegram -> users                (link uses OtpService)
notifications -> users, telegram (Telegram channel needs chat_id + bot client)
messaging                        (no domain imports)
auth -> users, notifications, redis
api-clients
bookings -> seats, places, users, notifications, messaging
admin -> bookings, seats, places
jobs -> bookings, notifications, messaging
```

Rules:
- A lower layer never imports a higher one.
- Cross-module calls go through exported services only, never another module's repository. The one exception: `bookings` exports `BookingsRepository` for `admin` and `jobs`.
- `user_otps` sits in `users`, not `auth`, so `telegram` can create TELEGRAM_LINK codes without the cycle auth → notifications → telegram → auth.

## 4. Inside a module (pattern; `bookings` shown)

```
bookings/
  bookings.module.ts
  controllers/
    bookings.controller.ts            # USER: /bookings...
    admin-bookings.controller.ts      # ADMIN: /admin/bookings...
    attendance.controller.ts          # /check-in/scan, /check-out/scan, manual check-in/out
    seat-availability.controller.ts   # /seats/available, /seats/:id/availability
  services/
    bookings.service.ts               # create, modify, extend, cancel (one transaction each)
    attendance.service.ts             # QR + manual check-in/out
    booking-qr.service.ts             # issue / verify / revoke one-time tokens
    booking-rules.service.ts          # policy checks: duration, slot, advance, active count, opening hours
    availability.service.ts
  repositories/
    bookings.repository.ts            # ALL tstzrange SQL + 23P01 -> ConflictException
  entities/
    booking.entity.ts
    booking-event.entity.ts
    booking-qr-token.entity.ts
  domain/
    booking-state.ts                  # allowed status transitions (state diagram in erd.md)
  dto/
    create-booking.dto.ts
    modify-booking.dto.ts
    extend-booking.dto.ts
    booking-query.dto.ts
    booking.response.dto.ts
  *.spec.ts                           # unit tests next to the file they test
```

Every module follows this layout, and folders a module doesn't need are left out:
- `controllers/`, `services/`, `repositories/` (only when a module needs custom queries), `entities/`, `dto/`.
- Admin controllers are named `admin-*.controller.ts` and use `@Roles(UserRole.ADMIN)`.

Other notable files:
- **auth/:** `auth.controller.ts`, `oauth.controller.ts`, `identities.controller.ts`, `token.service.ts` (JWT + refresh rotation), `oauth.service.ts` (lookup/link/create rules), `oauth-state.store.ts` (Redis), `providers/google.provider.ts`, `providers/facebook.provider.ts`, `strategies/jwt.strategy.ts`.
- **notifications/:** `notifications.service.ts`, `notification-dispatcher.service.ts`, `channels/email.channel.ts`, `channels/telegram.channel.ts`, `templates/`.
- **messaging/:** `rabbitmq/rabbitmq.module.ts` (connection, topic exchange `space-booking.events`), `outbox/`, `inbox/`, `consumers/` (one file per consumed event type).
- **jobs/:** `expire-bookings.job.ts`, `overdue-checkouts.job.ts`, `notification-dispatch.job.ts`, `outbox-relay.job.ts`.
  - Jobs only call services. Each job claims rows with `FOR UPDATE SKIP LOCKED`, so running several app instances is safe.

## 5. common/

```
common/
  enums/        # one file per DB enum in erd.md §4 (user-role.enum.ts, booking-status.enum.ts, ...);
                # used by entities, migrations, DTOs
  decorators/   # @CurrentUser, @Roles, @Public, @ApiClient, @Scopes
  guards/       # jwt-auth.guard (global, @Public opts out), roles.guard, scopes.guard
  filters/      # all-exceptions.filter -> { statusCode, message, error }
  interceptors/ # logging (no bodies, no emails/tokens)
  dto/          # pagination-query.dto, paginated-response.dto
  utils/        # hash (argon2, sha256 for tokens), random-token, time-range helpers, timezone helpers
```

**Global setup in `main.ts`:**
- `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`
- the exception filter
- guards in this order: JWT, then Roles

`ApiKeyGuard` (from `api-clients`) is applied per route, on routes that accept a client.

## 6. Configuration and database additions

- **configuration/:** new `auth.config.ts` (JWT secrets, TTLs), `oauth.config.ts`, `telegram.config.ts`, `rabbitmq.config.ts`, and `env.validation.ts` (validate at startup). Add each to `configurations` in `index.ts`.
  - **Proposed env vars** (propose in the PR first, per AGENTS §13): `JWT_*`, `GOOGLE_*`, `FACEBOOK_*`, `OAUTH_ALLOWED_REDIRECT_URIS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `RABBITMQ_URL`.
- **database/:**
  - `transformers/tstzrange.transformer.ts`
  - `seeds/` with `run-seeds.ts`, `admin.seed.ts`, `demo-place.seed.ts` (place + hours + policy + area + seats), all idempotent
  - a `seed` script added to package.json (AGENTS §4 lists `npm run seed`, but the script doesn't exist yet)

## 7. Infra and dependency follow-ups (flag, don't do now)
- Add a RabbitMQ service to `infrastructure/docker/development/docker-compose.yml`. It isn't there yet.
- **Missing packages:**
  - a mail sender (`nodemailer`)
  - a QR generator (`qrcode`)
  - Google/Facebook strategies (`passport-google-oauth20`, `passport-facebook`)
  - `google-auth-library`
  - a Telegram client: plain `fetch` to the Bot API, so no package is needed
- Decide **`@nestjs/schedule` vs BullMQ** for jobs. I recommend `@nestjs/schedule` + `SKIP LOCKED`. BullMQ is already installed if retries or a dashboard are wanted later.
- `@nestjs/event-emitter` is installed. Don't use it for anything that must survive a crash; that's what the outbox is for.

## 8. Ownership for 4–5 developers (suggested split)
1. auth + users + api-clients
2. places + areas + seats + admin
3. bookings (core, availability, QR) + one schema owner for migrations
4. notifications + telegram + jobs
5. messaging (outbox/inbox/RabbitMQ) + common + test utils

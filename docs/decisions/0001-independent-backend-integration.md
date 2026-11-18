# ADR 0001: Independent backend, role-based access, sync + async integration

- **Status:** Proposed (needs team review)
- **Date:** 2026-11-07

## Context

The first ERD (6 tables) was written for a library-focused booking app with place-scoped admin roles. The v1.0 draft spec (4 Nov 2026) adds areas, email OTP, refresh tokens, modify/extend, one-time QR check-in/out, Telegram alerts and admin monitoring. The team also decided that the Space Booking System is an **independent** backend: a Library Management System or any other app should be able to integrate with it, instead of this app depending on them.

## Decisions

1. **Generic domain.** The main entity is `places` (with `type` LIBRARY / CAFE / COWORKING / OTHER), not `libraries`. API paths use `/places`.
2. **Application roles are `SUPER_ADMIN`, `ADMIN`, and `USER`.** They are stored in the `roles` table and referenced by `users.role_id`. Roles that belong to other systems are not modelled now; a phase-2 `external_identities` table can carry them.
3. **Policies per place, not per role.** Grace period (15 min), reminder offsets, duration and advance limits live in `booking_policies`.
4. **Sync integration over HTTP.** Other services call our REST API authenticated as `api_clients` (hashed API key + scopes). Bookings record `client_id`.
5. **Async integration over RabbitMQ with a transactional outbox.** Domain changes insert into `outbox_events` in the same DB transaction; a relay publishes to the topic exchange `space-booking.events` (routing keys like `booking.created`, `booking.expired`). Consumed messages (and Telegram webhook updates) are deduplicated through `inbox_events`. Delivery is at-least-once; every consumer is idempotent.
6. **Notification channels.** Email only for auth (verify OTP, reset OTP). Telegram for booking alerts (confirmation, late check-in, checkout reminder, expiry, forgotten checkout). Delivery state is tracked in `notifications`.
7. **One-time QR tokens** per booking and purpose (`booking_qr_tokens`), hash-only, single use, revoked when reissued. Window rules are in code.
8. **No walk-ins** (not in the spec). `bookings.user_id` is required. Admin manual check-in covers the front desk.

## Consequences

- New dependencies to add when implementing: RabbitMQ client (e.g. `@nestjs/microservices` + `amqplib`, or `@golevelup/nestjs-rabbitmq`), a Telegram Bot API client, QR generation library. RabbitMQ service in Docker Compose.
- AGENTS.md sections on roles, schema, rules and endpoints are updated to match.
- `CHECKOUT_OVERDUE` occupies a seat logically but not by range; availability queries must account for it (see `docs/erd.md` section 7).
- The outbox relay and inbox processing are extra jobs to operate and test.

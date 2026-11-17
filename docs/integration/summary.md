# Integration: short summary

The short version of this folder. For details, start at [`README.md`](./README.md).

Space Booking connects to other backends (the LibraFlow LMS for now) in two ways:

| Need | Channel |
|---|---|
| "Do this now" | **HTTP**: the caller logs in as a system with an API key |
| "This happened" | **RabbitMQ**: each system publishes events to its own exchange |

Neither system calls the other while serving its own user's request. If LMS is down, seats can still be booked.

## The four modules

### `src/api-clients/`: who may call our API
- Other systems send an `X-API-Key: sbk_<live|test>_<prefix>_<secret>` header. No user JWT.
- Only `sha256(secret)` is stored, in `api_clients`. The full key is shown once, on create or rotate.
- Routes are protected with `@ClientSecured(...scopes)` and `ApiKeyGuard`. A bad key gets `401`, a missing scope gets `403`.
- Scopes: `places:read`, `identities:link`, `bookings:read`, `bookings:write`.
- Admin endpoints are under `/admin/api-clients` (create, list, get, update, rotate-key).

### `src/external-identities/`: one person, two accounts
- `external_identities`: our user ↔ LMS member id, plus the member's standing (eligible or not).
- `external_link_requests`: one-time link codes, stored as hashes only.
- Accounts are never matched by email. The link flow:
  1. LMS calls `POST /integrations/library/link-requests` with its API key and gets a code.
  2. The user, logged in on our side, confirms with `POST /integrations/library/my-link`.
- Bookings use it in two ways: an ineligible member at an LMS place gets `403`, and booking events carry the `memberId`.

### `src/integrations/`: LMS-specific logic
- `http/ServiceHttpClient` is a generic HTTP client. `LmsClient` uses it to call LMS from background jobs only.
- **Place sync:** LMS owns library places.
  - The `place.updated` event carries a full snapshot (hours, closures, areas, seats).
  - `LibraryPlaceSyncService` applies it and cancels bookings the change affects.
  - An hourly repair job re-fetches snapshots it missed.
  - Admins can force a resync with `POST /admin/integrations/library/places/:placeId/resync`.
- **Standing:** `member.standing_changed` updates eligibility. Events about unlinked members are ignored.

### `src/messaging/`: the RabbitMQ plumbing
- **Outbox (sending):** a booking change writes an `outbox_events` row in the same transaction. The relay publishes it to `space-booking.events` (`booking.created`, `.cancelled`, ...). Events are never lost and never sent for a rolled-back change.
- **Inbox (receiving):** `ConsumerRunner` reads `library.events`, with `.retry` and `.dlq` queues. `InboxService.handleOnce` inserts into `inbox_events` with `ON CONFLICT DO NOTHING` and runs the handler in the same transaction, so duplicates are processed once.
- **Contract:** every message is validated with `ajv` against `src/messaging/contract/schemas.ts`.
- Messaging is off when `RABBITMQ_URL` is empty.

## How they fit

```
messaging            moves the events (outbox out, inbox in)
integrations/library decides what LMS events mean (place sync, standing, linking)
external-identities  remembers who is who (user ↔ LMS member)
api-clients          controls who may call our API (API keys + scopes)
```

## Status
- **Built (phase 1, our side):** broker, outbox relay, consumer, place sync, API keys, LMS HTTP client, account linking.
- **Not built:** phases 2–3 (for example `X-External-User` acting on behalf of a member) and the whole LMS side.
- Everything in this folder is a **proposal**: nothing is agreed with the LMS team yet.

## Where to read more
| Topic | File |
|---|---|
| Every message we publish and consume | [`lms-message-contract.md`](./lms-message-contract.md) |
| How the two systems trust each other | [`service-authentication.md`](./service-authentication.md) |
| Envelope, versioning, retries | [`messaging-contract.md`](./messaging-contract.md) |
| Local setup and hand-off | [`lms-booking-events-now.md`](./lms-booking-events-now.md) |

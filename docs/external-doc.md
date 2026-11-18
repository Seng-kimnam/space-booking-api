# External integration: how it works

A practical guide to how Space Booking talks to external systems. Today the only partner is the **LibraFlow Library Management System (LMS)**.
For the full contract and design, see [`docs/integration/README.md`](./integration/README.md).

> **Status.** Everything below is **implemented** on our side unless marked **Planned**. The LMS side is a separate project.

---

## 1. Architecture

Two channels, each for a different need:

| Need | Channel | Direction |
|---|---|---|
| "This happened" (facts) | **RabbitMQ**, async | Both ways |
| "Do this now / give me data" | **HTTP + API key**, sync | LMS → us (link codes, sync status); us → LMS (repair job only) |

Neither system calls the other while serving a user's request. If the LMS is down, bookings still work and events wait in the outbox or queue.

```
 LMS outbox ──► library.events (topic) ──bind──► space-booking.library-events ──► LibraryEventsConsumer
                                                    │ fail ► .retry (TTL) ► back
                                                    └ poison / max attempts ► .dlq
 our outbox_events ──► OutboxRelayJob (5 s) ──► space-booking.events (topic) ──► LMS queues
```

### RabbitMQ objects

| Object | Name | Owner |
|---|---|---|
| Our exchange (we publish here only) | `space-booking.events` (topic) | us (declared by `RabbitPublisher`) |
| LMS exchange | `library.events` (topic) | LMS (we only bind to it) |
| Our queue for LMS events | `space-booking.library-events` (+ `.retry`, `.dlq`, all quorum) | us |
| Dead-letter exchange | `space-booking.dlx` (direct), keys `library-events`, `.retry`, `.dlq` | us |
| Dev vhost / users | `space-library-dev`; users `space-booking`, `library` | `infrastructure/rabbitmq/setup-dev.sh` |

### Routing keys (`src/messaging/contract/schemas.ts`, `MessageType` / `CONTRACT`)

| We **publish** | We **consume** (from LMS) |
|---|---|
| `booking.created`, `booking.modified`, `booking.extended`, `booking.cancelled`, `booking.checked_in`, `booking.checked_out`, `booking.expired`, `booking.checkout_overdue`, `booking.alert_due` | `place.created`, `place.updated` (full place snapshot) |
| `place.sync_applied`, `place.sync_rejected` (replies to snapshots) | `member.standing_changed` |
| `identity.linked`, `identity.unlinked` | |

A schema version above 1 is published as `<key>.v<N>`, so v1 consumers never get a v2 body (`src/messaging/outbox/envelope.ts`).

### Message contract

Every message is an **envelope** (`docs/integration/schemas/envelope.v1.json`):

```json
{ "id": "<uuid>", "type": "place.updated", "version": 1, "source": "library",
  "occurredAt": "2026-11-09T09:00:00.000Z", "correlationId": null,
  "subject": { "type": "place", "id": "1" }, "data": { "...": "per-type schema" } }
```

- **AMQP properties must match the body:** `message_id = id`, `type = type`, `app_id = source = user_id`.
- **`user_id` is our trust check.** The broker verifies it against the publishing connection, so only the `library` user can send LMS events.
- **Schemas** are defined in code (`src/messaging/contract/schemas.ts`) and exported as files in `docs/integration/schemas/`. Examples are in `docs/integration/fixtures/*.json`.

### HTTP

| Route | Caller | Auth |
|---|---|---|
| `GET /api/v1/integrations/library/places/:placeId` | LMS | API key, scope `places:read` |
| `POST /api/v1/integrations/library/link-requests` | LMS | API key, scope `identities:link` |
| `DELETE /api/v1/integrations/library/links/:memberId` | LMS | API key, scope `identities:link` |
| `POST/GET/DELETE /api/v1/integrations/library/my-link` | our user | JWT, `USER` |
| `POST /api/v1/admin/integrations/library/places/:placeId/resync` | our admin | JWT, `ADMIN` |
| `/api/v1/admin/api-clients` (create, list, get, update, `:clientId/rotate-key`) | our admin | JWT, `ADMIN` |
| **Out:** `GET {LMS_BASE_URL}/external/places/:id/snapshot` | our repair job | `x-api-key: $LMS_API_KEY` |

- API keys are sent in the `x-api-key` header, format `sbk_<live|test>_<prefix>_<secret>`. We store only the hash.
- **Planned:** scopes `bookings:read` and `bookings:write` exist in `src/api-clients/api-key.ts`, but no route uses them yet. Booking on behalf of a member (`@UserOrClient`, `X-External-User`) is not built.

---

## 2. Message flow

### Publishing (us → LMS): the transactional outbox

1. A service changes data and calls `OutboxService.add(manager, …)` in **the same transaction**. The event exists only if the change commits.
2. `OutboxService` refuses unknown routing keys and payloads that fail the schema (`ContractViolationError`). The whole change then rolls back.
3. `OutboxRelayJob` (`src/jobs/outbox-relay.job.ts`, every 5 s) calls `OutboxRelayService.relayBatch()`, which works like this:
   - claims unpublished rows with `FOR UPDATE SKIP LOCKED`, oldest `occurred_at` first;
   - turns each row into an AMQP message with `toMessage()` (`envelope.ts`);
   - publishes it on a confirm channel and sets `published_at`.
4. When a publish fails, the relay stores `attempts` and `last_error` on the row and stops the batch to keep the order. It retries on the next tick.
5. A crash can re-send a row. Consumers dedupe on `message_id`.

### Consuming (LMS → us): `ConsumerRunner` + inbox

`LibraryEventsConsumer` (`src/integrations/library/consumers/`) registers a route. `ConsumerRunner` then does the following:

1. Waits until `library.events` exists (it checks every 30 s and logs one warning), then declares our queues and binds each handled key.
2. For each delivery:
   - **trust check** (`user_id`, `app_id`) → JSON → envelope schema → properties match body → data schema;
   - then `InboxService.handleOnce()`, which inserts an `inbox_events` row and runs the handler **in one transaction**;
   - a duplicate `(source, message_id)` is skipped.
3. **Outcomes:**

   | Result | What happens |
   |---|---|
   | Success, or a duplicate | `ack` |
   | Unknown type | `ack` and ignored (debug log) |
   | Transient error | `nack`; the message waits in `.retry` for `RABBITMQ_RETRY_DELAY_MS`, then comes back |
   | Poison (bad JSON, schema, untrusted), or `RABBITMQ_MAX_ATTEMPTS` reached | Copied to `.dlq` with `x-error` and `x-attempts` headers, then acked |

### What the handlers do (`src/integrations/library/services/`)

- **`place.created` / `place.updated`** go to `LibraryPlaceSyncService.apply()`:
  - Ignores a stale `revision`.
  - Checks the business rules in `domain/place-snapshot.rules.ts`.
  - Updates the place, opening hours, future closures, areas and seats.
  - Cancels future `PENDING` bookings that became impossible.
  - Replies `place.sync_applied`; a rule failure replies `place.sync_rejected` and the message is acked.
  - New LMS places start **inactive** until one of our admins activates them.
- **`member.standing_changed`** goes to `LibraryLinksService.applyStanding()`. It stores eligibility on the linked `external_identities` row; members who aren't linked are ignored. Bookings then return `403` for members who aren't eligible at LMS places.
- **Repair job** (`jobs/place-repair.job.ts`, hourly, 50 places per run): fetches snapshots over HTTP and applies them the same way. It does nothing while `LMS_BASE_URL` is empty.

---

## 3. Folder structure

| Folder | Purpose |
|---|---|
| `src/messaging/` | Generic broker plumbing, not tied to any partner (global module) |
| `  rabbitmq/` | One connection (`RabbitConnection`) and the confirm-channel publisher |
| `  outbox/` | `OutboxService` (writes and validates events), relay, `envelope.ts` (row → AMQP) |
| `  inbox/` | `InboxService.handleOnce()`, exactly-once processing per `message_id` |
| `  consumers/` | `ConsumerRunner` (retry, DLQ, trust check), `ConsumerRoute` type |
| `  contract/` | JSON schemas, `MessageType`, `CONTRACT` registry, `SchemaValidator`, `@Publishes` |
| `  entities/` | `outbox_events`, `inbox_events` |
| `src/integrations/http/` | `ServiceHttpClient`: JSON GET with API key, timeout, retries |
| `src/integrations/library/` | Everything LMS-specific |
| `  clients/` | `LmsClient` (HTTP out) |
| `  consumers/` | `LibraryEventsConsumer` (route and handlers) |
| `  controllers/` | Place status, admin resync, link requests, my-link |
| `  services/` | Place sync, place repair, account links |
| `  domain/` | Pure snapshot rules (no DB) |
| `  jobs/`, `pipes/`, `dto/` | Hourly repair cron, LMS id validation, request and response DTOs |
| `src/api-clients/` | API keys for partner systems: `ApiKeyGuard`, `@ClientSecured(...scopes)`, admin CRUD |
| `src/external-identities/` | `external_identities` (user ↔ LMS member, standing) and `external_link_requests` (one-time codes, hash only) |
| `src/configuration/` | `rabbitmq.config.ts`, `integrations.config.ts`, `env.validation.ts` |
| `infrastructure/` | Docker Compose with RabbitMQ, plus `rabbitmq/setup-dev.sh` |
| `docs/integration/` | Contract, schemas, fixtures, hand-off notes |

---

## 4. Local setup

### Infrastructure

```bash
COMPOSE="docker compose --env-file .env -f infrastructure/docker/development/docker-compose.yml"
$COMPOSE up -d                              # Postgres, RabbitMQ (rabbitmq:4.1-management-alpine), ...
$COMPOSE exec rabbitmq sh /setup-dev.sh     # once: vhost space-library-dev, users space-booking / library
npm run migration:run
npm run start:dev
```

Management UI: http://localhost:15672 (admin `admin` / `admin_dev` by default; for people, not apps).

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `RABBITMQ_URL` | empty | `amqp://space-booking:space-booking-dev@localhost:5672/space-library-dev`. **Empty = messaging off**: outbox rows stay unpublished and no consumer starts |
| `OUTBOX_RELAY_BATCH` | `100` | Rows per relay transaction |
| `RABBITMQ_PREFETCH` | `10` | Unacked messages per consumer channel |
| `RABBITMQ_MAX_ATTEMPTS` | `5` | Attempts before the DLQ |
| `RABBITMQ_RETRY_DELAY_MS` | `30000` | TTL of `.retry`. To change it on an existing queue, delete the queue first |
| `LIBRARY_INTEGRATION_ENABLED` | off | Must be `true` to start the LMS consumer |
| `LMS_BASE_URL` | empty | LMS REST base URL. Empty = repair job and admin resync off (resync returns `503`) |
| `LMS_API_KEY` | empty | Key the LMS issued us; required (16+ chars) when `LMS_BASE_URL` is set |
| `LMS_TIMEOUT_MS` | `5000` | Per HTTP attempt (3 retries, 500 ms backoff) |
| `LIBRARY_LINK_TTL_MINUTES` | `10` | Link code lifetime |
| `LIBRARY_LINK_URL_TEMPLATE` | empty | http(s) URL with `{code}`; empty = `linkUrl: null` |

Source: `src/configuration/rabbitmq.config.ts`, `integrations.config.ts` and `env.validation.ts`. Startup fails on invalid values.

**Expected log** with everything on: `Connected to RabbitMQ`, then `Consuming space-booking.library-events (...)`. Until the LMS has declared `library.events`, you get one warning instead: "Exchange library.events not declared yet".

---

## 5. Testing without the LMS

### Automated tests (no broker, no LMS needed)

```bash
npm test                         # unit: contract, schemas vs fixtures, consumer runner, envelope, snapshot rules, HTTP/LMS client, API keys
npm run test:e2e                 # needs a migrated *_test DB (see AGENTS.md section 4)
```

| E2E spec (real Postgres) | Covers |
|---|---|
| `test/e2e/integrations/library-place-sync.e2e-spec.ts` | Snapshots through the real inbox and outbox (fixture `place.updated.v1.json`), bookings cancelled, rejections |
| `test/e2e/integrations/library-links.e2e-spec.ts` | Link codes, `identity.linked/unlinked`, standing blocks bookings |
| `test/e2e/messaging/outbox-relay.e2e-spec.ts` | Order, failure handling, no double publish (fake publisher) |
| `test/e2e/api-clients/api-clients.e2e-spec.ts` | API key auth and scopes |

These call the services directly (for example `LibraryPlaceSyncService.apply` inside `InboxService.handleOnce`), so they need no RabbitMQ.

### Manual: act as the LMS in the RabbitMQ UI

1. Set `RABBITMQ_URL` and `LIBRARY_INTEGRATION_ENABLED=true`, then start the app.
2. In the UI, as `admin`, open vhost `space-library-dev` and add exchange **`library.events`** (topic, durable). Within 30 s our three queues appear.
3. Log in as **`library` / `library-dev`**. On `library.events`, choose **Publish message** with:
   - **Routing key:** `place.created`
   - **Properties:** `message_id=<new uuid>`, `app_id=library`, `user_id=library`, `type=place.created`, `content_type=application/json`
   - **Payload:** the `body` of `docs/integration/fixtures/place.created.v1.json`, with `id` set to the same new uuid
4. Check the result. The place, areas and seats appear in the DB, **inactive**. To see the `place.sync_applied` reply, bind a test queue to `space-booking.events`.
5. More cases to try:

   | Try | Expect |
   |---|---|
   | Publish the same message again | No change (duplicate) |
   | Publish without `user_id` | Message in `space-booking.library-events.dlq` with header `x-error` |
   | Snapshot with a duplicate seat label | `place.sync_rejected` with code `SEAT_LABEL_CONFLICT`; DB unchanged |

Other fixtures, such as `member.standing_changed.v1.json`, work the same way.

### Manual: HTTP

```bash
# 1. As admin: POST /api/v1/admin/api-clients  { "name": "LMS", "scopes": ["places:read","identities:link"] }  -> returns the key once
curl -H "x-api-key: sbk_test_..." http://localhost:3000/api/v1/integrations/library/places/1
curl -X POST -H "x-api-key: sbk_test_..." -H "content-type: application/json" \
     -d '{"memberId":"88"}' http://localhost:3000/api/v1/integrations/library/link-requests
```

**Fake LMS for the repair job:**
- Point `LMS_BASE_URL` at any server that answers `GET /external/places/:id/snapshot` with `{ "revision": <n>, "data": <snapshot> }`. The `data` can come from a fixture's `body.data`.
- Then call `POST /api/v1/admin/integrations/library/places/:placeId/resync` as an admin.

---

## 6. Troubleshooting

| Symptom | Likely cause | Where to look |
|---|---|---|
| `RABBITMQ_URL is empty: messaging is off` | URL not set | `.env`; `outbox_events` rows have `published_at IS NULL` |
| `RabbitMQ connection failed: ... ACCESS-REFUSED` / vhost not found | Setup script not run, or wrong user, password or vhost | Run `setup-dev.sh`; check the URL path `/space-library-dev` |
| `LIBRARY_INTEGRATION_ENABLED is not true: LMS consumer is off` | Flag not `true` | `.env` |
| `Exchange library.events not declared yet` | LMS hasn't started yet | Declare it by hand (section 5) or start the LMS |
| `Outbox <id> (...) not published, retrying next tick` | Broker down or publish not confirmed | `outbox_events.attempts`, `last_error` |
| `Refused to publish <type>` / `ContractViolationError` | Our payload breaks the schema (a bug) | `src/messaging/contract/schemas.ts` vs the producing service |
| Message in `...library-events.dlq` | Poison message or max attempts reached | DLQ message headers `x-error`, `x-attempts`, `x-original-user-id` |
| Message keeps coming back | Handler throws a transient error | App log `attempt N failed (...)`; `.retry` queue |
| `PRECONDITION_FAILED` on queue declare | Queue arguments changed (e.g. `RABBITMQ_RETRY_DELAY_MS`) | Delete the queue in the UI and restart |
| Snapshot did nothing | Stale `revision`, or rejected | Log `Stale snapshot ignored` / `LMS place snapshot rejected ... code=`; `place.sync_rejected` reply |
| Admin edit of a place returns `409` | The place is owned by LMS | Change it in the LMS |
| Resync returns `503` / `404` | `LMS_BASE_URL` empty / the LMS has no such place | `.env`; LMS logs |
| Partner HTTP call returns `401` / `403` | Bad or inactive key / missing scope | `/admin/api-clients`; header must be `x-api-key` |
| A processed message needs re-processing | Already in the inbox | `inbox_events` (`source`, `message_id`) |

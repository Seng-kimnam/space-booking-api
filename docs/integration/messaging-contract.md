# Messaging contract (RabbitMQ)

- **Status:** Proposed (needs review by our team and every integrating team). Last updated 2026-11-10: LMS events, broker-validated `user_id`, dead-letter based retries, and the inbox transaction rule.
- **Applies to:** any external application that integrates with the Space Booking API
- **Related:** ADR 0001 (decisions 4 and 5), `docs/api-endpoints.md` sections 8 and 9, `docs/erd.md` (`outbox_events`, `inbox_events`, `api_clients`)
- **Start at:** [`README.md`](./README.md). Authentication between systems: [`service-authentication.md`](./service-authentication.md). Setup and build steps: [`implementation-plan.md`](./implementation-plan.md).
- **App-specific plans:** LMS: [`lms-booking-events-now.md`](./lms-booking-events-now.md) (step 1, implemented on our side: booking events before place sync), [`../lms-integration-proposal.md`](../lms-integration-proposal.md) (full design), [`library-management-system.md`](./library-management-system.md) (use cases and questions)

This document defines **how** we talk to other systems: transport, message format, naming, versioning, delivery and security. Each integration then only has to agree on **what** is exchanged (which events, which fields). Any app that follows these rules can integrate without us changing our design.

---

## 1. Principles

1. **We are independent.** Space Booking never needs another system to be up to work. Other apps integrate with us; we don't call into them during a request.
2. **Two channels, each for one job.**

   | Need | Channel | Why |
   |---|---|---|
   | "Do this and tell me the result now" (create/cancel a booking, read availability) | **Sync REST**, `/api/v1`, authenticated as an `api_clients` key with scopes | The caller needs an answer (201, 409 seat taken, ...) |
   | "This happened" (booking created, member suspended) | **Async RabbitMQ events** | The producer must not wait for or depend on the consumer |

3. **Events are facts, in the past tense.** `booking.created`, not `create.booking`. An event never asks the receiver to do something. If one system wants another to *do* something and needs the result, it calls REST.
4. **The producer owns its exchange and its contract.** We publish only to `space-booking.events`. Another team publishes only to its own exchange. Each consumer creates and owns its own queues.
5. **Messages carry ids and facts, never secrets.** No passwords, hashes, tokens, QR data, API keys or idempotency keys (AGENTS.md section 6.9). Keep personal data to the minimum the consumer needs.
6. **At-least-once delivery.** Every consumer must be idempotent, and no consumer may assume ordering (section 6).
7. **Systems authenticate as themselves, never with users' tokens.** HTTP uses an API key issued by the receiver. RabbitMQ uses a broker user per system, plus the broker-validated `user_id` property. A person's accounts in two systems are linked explicitly, never matched by email. See [`service-authentication.md`](./service-authentication.md).
8. **Publish facts, not UI messages.** We publish `booking.cancelled`, not "send this notification text". Each consumer turns facts into its own notifications, in its own wording.

---

## 2. Topology

```
 Space Booking API                                            External app (e.g. LMS)
 ─────────────────                                            ───────────────────────
 booking change ─┐
                 │ same DB transaction
                 ▼
          outbox_events ── outbox relay ──► exchange: space-booking.events (topic)
                                                    │  bindings: booking.created, booking.cancelled, ...,
                                                    │            place.sync_applied, place.sync_rejected
                                                    ▼
                                            queue: library.space-booking-events ──► LMS consumer
                                                    ├─► (nack) library.dlx ─► .retry (TTL) ─► back
                                                    └─► DLQ: library.space-booking-events.dlq

 exchange: library.events (topic) ◄── LMS publishes (their own outbox)
          │  bindings: place.created, place.updated (phase 3: member.standing_changed)
          ▼
 queue: space-booking.library-events ──► our consumer ──► inbox_events (dedupe) ──► handler
          ├─► (nack) space-booking.dlx ─► .retry (TTL 30 s) ─► back to the main queue
          └─► DLQ: space-booking.library-events.dlq
```

Exact declarations (arguments, bindings, retry routing): [`implementation-plan.md`](./implementation-plan.md) §3.4.

### Naming rules

| Thing | Pattern | Example |
|---|---|---|
| Exchange (one per producing system) | `<producer>.events`, type `topic`, durable | `space-booking.events`, `library.events` |
| Routing key | `<aggregate>.<event>` in lowercase `snake_case`; major version suffix from v2 on (section 5) | `booking.created`, `booking.checked_in`, `booking.created.v2` |
| Queue (one per consumer per purpose) | `<consumer>.<producer>-events[.<purpose>]`, durable, quorum | `library.space-booking-events` |
| Dead-letter exchange (consumer-owned) | `<consumer>.dlx`, type `direct` | `space-booking.dlx` |
| Dead-letter queue | `<queue>.dlq` | `library.space-booking-events.dlq` |
| Retry queue | `<queue>.retry` with queue TTL; dead-letters back to the main queue through `<consumer>.dlx` | `space-booking.library-events.retry` |

- The **producer** declares its exchange.
- The **consumer** declares its own queue, `.dlx`, retry queue, DLQ and bindings. The producer doesn't need to know who listens.
- Bind only to the keys you handle, **listed one by one** (e.g. `booking.created`, `booking.cancelled`), never `#`. Then a new event type never reaches a consumer before it chooses to bind it. `booking.created` does **not** match `booking.created.v2`, which is intended (section 5).
- All of a system's own exchanges and queues start with its name. That's what the broker permissions in section 7 rely on.

### Environments

Use one vhost per environment (e.g. `space-library-dev`, `space-library-staging`, `space-library-prod`) on a shared broker. Never mix environments on one exchange.

---

## 3. Message format

### 3.1 AMQP properties (set on every message)

| Property | Value | Used for |
|---|---|---|
| `message_id` | Event id (UUID). For us, `outbox_events.id` | Consumer dedupe (`inbox_events.message_id`) |
| `type` | Routing key without version, e.g. `booking.created` | Routing in the consumer |
| `app_id` | Producer name: `space-booking`, `library` | `inbox_events.source` |
| `user_id` | The producer's **broker username** (the same string as `app_id`) | Sender proof: the broker rejects a publish whose `user_id` doesn't match the connection's user. Consumers reject messages without it. |
| `content_type` | `application/json` | |
| `content_encoding` | `utf-8` | |
| `delivery_mode` | `2` (persistent) | Survives a broker restart |
| `timestamp` | When the event happened (Unix seconds) | |
| `correlation_id` | Request id or idempotency trace, if any | Tracing across systems |
| header `x-schema-version` | Major schema version as a string: `"1"` | Pick the right parser |

### 3.2 Body: the envelope

Every event, from every producer, uses the same envelope. Only `data` differs per event type.

```json
{
  "id": "0b8f5a8e-6a0f-4f0a-9c51-2b1f0e7d9a10",
  "type": "booking.created",
  "version": 1,
  "source": "space-booking",
  "occurredAt": "2026-11-09T10:15:00.000Z",
  "correlationId": "a1c2…",
  "subject": { "type": "booking", "id": "7d0e…" },
  "data": { }
}
```

| Field | Type | Rule |
|---|---|---|
| `id` | UUID | Same as AMQP `message_id`; unique per event |
| `type` | string | Same as AMQP `type` |
| `version` | integer | Major schema version of `data` |
| `source` | string | Same as AMQP `app_id` |
| `occurredAt` | ISO 8601 UTC string | When the change happened (not when it was sent) |
| `correlationId` | string or null | Optional |
| `subject` | `{ type, id }` | The aggregate the event is about (`outbox_events.aggregate_type` / `aggregate_id`) |
| `data` | object | Event-specific payload (section 4) |

Rules for `data`:

- Times are ISO 8601 strings in **UTC** (`...Z`). The consumer converts to local time.
- Ids are UUID strings. Enums are UPPER_SNAKE strings, e.g. `"status": "PENDING"`.
- Optional fields are **present with `null`**, not missing, so consumers can tell "unknown" from "not sent".
- No secrets (principle 5).

### 3.3 Mapping to our outbox

`outbox_events` already stores `id`, `aggregate_type`, `aggregate_id`, `event_type`, `payload` and `occurred_at`. The outbox relay (`src/messaging/outbox/envelope.ts`) builds the envelope from the row:

| Envelope / property | From |
|---|---|
| `id`, `message_id` | `outbox_events.id` |
| `type`, routing key | `outbox_events.event_type` |
| `subject` | `aggregate_type`, `aggregate_id` |
| `occurredAt` | `outbox_events.occurred_at` |
| `version`, `x-schema-version` | `payload.schemaVersion` |
| `data` | `payload` without `schemaVersion` |

So booking services keep writing outbox rows exactly as they do now; only the relay knows the wire format.

---

## 4. Events we publish (`space-booking.events`, v1)

Implemented today (written to the outbox and published by the relay when `RABBITMQ_URL` is set): all `booking.*` keys below. `seat.status_changed` is listed in `api-endpoints.md` but **not emitted yet**.

| Routing key | When | Produced by |
|---|---|---|
| `booking.created` | Booking reserved (one event per seat of a multi-seat booking, same `groupId`) | `BookingsService.create` |
| `booking.modified` | Time range changed | `BookingsService.modify` |
| `booking.extended` | End time extended | `BookingsService.extend` |
| `booking.cancelled` | Cancelled by user, admin or API client | `BookingsService.cancel` |
| `booking.checked_in` / `booking.checked_out` | Attendance by QR or admin | `AttendanceService` |
| `booking.expired` | No-show after the grace period | Expire job |
| `booking.checkout_overdue` | Not checked out after end + `overdue_alert_minutes` | Overdue job |
| `seat.status_changed` | Admin changed a seat status (**not emitted yet**) | `SeatsService.setStatus` |

### 4.1 `data` for every `booking.*` event (v1)

This is what `BookingActivityService.record` writes today:

```json
{
  "bookingId": "7d0e…",
  "groupId": "3a91…",
  "userId": "4444…0002",
  "seatId": "5f2c…",
  "placeId": "1b7d…",
  "source": "APP",
  "status": "PENDING",
  "startAt": "2026-11-10T02:00:00.000Z",
  "endAt": "2026-11-10T04:00:00.000Z",
  "previousStartAt": "2026-11-10T01:00:00.000Z",
  "previousEndAt": "2026-11-10T03:00:00.000Z",
  "actor": { "userId": "4444…0002" },
  "occurredAt": "2026-11-09T10:15:00.000Z"
}
```

- `previousStartAt` / `previousEndAt` are set on `booking.modified` and `booking.extended`; the relay sends them as `null` on other events (rule 3.2). It also sends `external: null` until partner ids exist (section 4.2).
- `actor` is `{ "userId": … }` or `{ "system": true }` (jobs).
- `source`: `APP | API_CLIENT | ADMIN`. `status`: `PENDING | CHECKED_IN | CHECKOUT_OVERDUE | COMPLETED | CANCELLED | EXPIRED`.
- **Gap:** `userId` is *our* user id. An external app can't map it to its own member without an identity mapping. The fix is the additive `external` block in section 4.2.

The v1 schemas are in `docs/integration/schemas/` (`envelope.v1.json`, `booking.v1.json` for all `booking.*` keys), with example messages in `docs/integration/fixtures/`; `booking-activity.contract.spec.ts` checks our payloads against them. That's the same file the consumer runner validates with ([`implementation-plan.md`](./implementation-plan.md) §3.1); partners keep a copy and contract-test against it. An AsyncAPI file can be generated from them later.

### 4.2 Proposed additions for partners

All of these are **proposed**. They're additive (same version) unless marked. Full payloads are in [`../lms-integration-proposal.md`](../lms-integration-proposal.md) §7.4.

| Routing key / field | When | Produced by (planned) | Phase |
|---|---|---|---|
| `external` on every `booking.*` | `{ system, placeId, seatId, memberId }` in the partner's ids; `null` for places a partner doesn't manage | `BookingActivityService.record` (looks up the place/seat `external_id` and the user's `external_identities` row) | 1 (place, seat), 2 (member) |
| `cancelReason` on `booking.cancelled` | Machine code (`USER_CANCELLED`, `ADMIN_CANCELLED`, `LIBRARY_PLACE_CHANGED`). User free text is **not** forwarded. | Same | 1 |
| `booking.alert_due` | A scheduled alert became due: `alertType` ∈ `LATE_CHECKIN`, `CHECKOUT_REMINDER`, `FORGOTTEN_CHECKOUT` | `NotificationDispatcher`, in the same transaction that claims the due `notifications` row, **whatever the channel outcome** (a user without Telegram still gets the event) | 2 |
| `place.sync_applied` / `place.sync_rejected` | We applied or rejected a partner's place snapshot | `LibraryPlaceSyncService` | 1 |
| `identity.linked` / `identity.unlinked` | A partner user and one of our users were linked or unlinked | Link service | 2 |

`booking.alert_due` `data`:

```json
{
  "bookingId": "7d0e…", "groupId": "3a91…", "seatId": "5f2c…", "placeId": "1b7d…",
  "alertType": "LATE_CHECKIN",
  "startAt": "2026-11-10T02:00:00.000Z", "endAt": "2026-11-10T04:00:00.000Z",
  "dueAt": "2026-11-10T02:05:00.000Z",
  "occurredAt": "2026-11-10T02:05:01.000Z",
  "external": { "system": "library", "placeId": "1", "seatId": "57", "memberId": "88" }
}
```

Why a separate event: the other alert types (`BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, `CHECKED_IN`, ...) coincide with a status change and already have a `booking.*` event. These three don't, so without `booking.alert_due` a partner couldn't show them.

### 4.3 Events we consume (proposed)

| Exchange | Routing key | Our reaction | Phase |
|---|---|---|---|
| `library.events` | `place.created`, `place.updated` | Apply the place snapshot if its `revision` is newer; reply `place.sync_*`. **Implemented** (`src/integrations/library/`) | 1 |
| `library.events` | `member.standing_changed` | Store eligibility on the identity mapping | 3 |

---

## 5. Versioning

A published contract is a public API (AGENTS.md section 8).

| Change | Breaking? | What to do |
|---|---|---|
| Add an optional field | No | Same version. Consumers must **ignore unknown fields**. |
| Add a new event type | No | New routing key, announce it |
| Add a new enum value | **Yes, unless agreed** | Consumers must handle unknown enum values safely (log and skip). Announce before shipping. |
| Remove, rename or retype a field; change meaning | Yes | New major version |

For a new major version N:

1. Publish **both** `booking.created` (v1) and `booking.created.vN` (with `x-schema-version: N`) during an agreed deprecation window (e.g. one release, or 30 days).
2. Consumers move their binding to the new key.
3. Remove v1 only after every consumer confirms.

The `vN` suffix in the routing key means an old consumer bound to `booking.created` never receives a v2 message it can't parse.

---

## 6. Delivery guarantees

### Producing (our side)

- **Transactional outbox** (AGENTS.md section 6.11): the event row is written in the same DB transaction as the change, so an event exists if and only if the change committed. Never publish from a request handler.
- The relay publishes unpublished rows in `occurred_at` order, waits for a **publisher confirm**, then sets `published_at`. If publishing fails it increments `attempts` and stores `last_error`.
- A crash between the confirm and `published_at` causes a **duplicate**. That's why consumers dedupe.

### Consuming (both sides)

1. Check the sender: `user_id` is the expected producer and equals `app_id` ([`service-authentication.md`](./service-authentication.md) §3.2). Then validate the schema.
2. In **one** DB transaction: insert into the inbox (ours is `inbox_events (source, message_id)` with a unique key, so a duplicate insert does nothing, AGENTS.md section 6.12), and if the row is new, run the handler on the same transaction, including any outbox rows it writes.
3. If the handler throws, the transaction rolls back **including the inbox row**, so the redelivery is processed again. (Today's `interimInbox` uses separate statements and drops redeliveries of failed messages. It must be replaced before the first RabbitMQ consumer: [`implementation-plan.md`](./implementation-plan.md) §3.3.)
4. **Ack only after** the transaction commits. Use manual ack and `prefetch` of about 10.

### Ordering

RabbitMQ keeps order within one queue, but retries and redeliveries can still reorder events. A consumer must not assume `booking.created` arrives before `booking.cancelled`:

- Compare `occurredAt` (or a per-aggregate version, if we add one) and ignore events older than what you already stored.
- Or treat each event as "fetch the current state via REST" when exact state matters.
- State-carrying events should carry a full snapshot and a per-aggregate `revision`, like LMS `place.updated`. The consumer applies only newer revisions, so order and gaps stop mattering.

### Failures

| Error | Action |
|---|---|
| Temporary (DB down, timeout, deadlock) | `nack(requeue=false)` → the broker dead-letters it to `<queue>.retry` (TTL 30 s) → back to the main queue. Count attempts from the broker's `x-death` header. On the 5th failure the consumer copies it to the DLQ and acks. |
| Permanent (invalid JSON, untrusted sender, schema mismatch, unknown version) | Consumer copies it to the DLQ and acks; log `message_id`; alert |
| Business rejection (valid message, data we can't accept) | Ack, and publish a reply fact if the contract defines one (e.g. `place.sync_rejected`) |
| Unknown `type` on a bound key | Ack and ignore (log at debug) |

A consumer **never re-publishes** the producer's message to retry it. The broker validates `user_id`, so the copy would be rejected, or would lose its proof of origin. Retries go through dead-lettering, which keeps all properties. The DLQ copy is the only re-publish: it drops `user_id` and keeps the original in header `x-original-user-id`.

Someone must watch every DLQ. After a fix, re-sync snapshot-style aggregates rather than replaying them; other messages are replayed with a tool (`implementation-plan.md` §7).

---

## 7. Security

- **One RabbitMQ user per system per environment.** No shared accounts, no `impersonator` tag.
- Permissions (RabbitMQ `configure` / `write` / `read` regexes). Every object a system owns starts with its name:
  - `space-booking`: configure `^space-booking\..*`, write `^space-booking\..*`, read `^space-booking\..*|^library\.events$` (read on the other exchange is needed to bind to it).
  - `library`: configure `^library\..*`, write `^library\..*`, read `^library\..*|^space-booking\.events$`.
  - Nobody gets write on `amq.default` (it would allow dropping messages into any queue by name).
- **Sender proof:** every producer sets `user_id` to its broker username. The broker rejects a mismatch; consumers reject messages without it.
- TLS (`amqps://`) outside local development. Credentials come from env vars validated at startup, never committed.
- HTTP between systems, API keys and user linking: [`service-authentication.md`](./service-authentication.md).
- Consumers **validate every message** against the schema before using it, and never trust ids blindly. For example, a member id from LMS must exist in our identity mapping before we act on it.
- Never log full payloads in production. Log `message_id`, `type` and `source`.

---

## 8. Checklist for a new integrating app

1. Agree on the use cases: what each side needs to know, and whether it's a fact (event) or a command needing an answer (REST).
2. Agree on the identity mapping between their users and ours.
3. For REST: we create an `api_clients` row with the minimum scopes (`POST /admin/api-clients`, not built yet).
4. For events they consume: they declare their queue and bind to our keys. We share the JSON Schemas.
5. For events we consume: they document their exchange, keys and schemas using this envelope. We add a consumer under `src/messaging`, with inbox dedupe and a DLQ.
6. Agree on a test plan: a shared staging broker, example messages per event, and how to replay the DLQ.
7. Record the decisions in an ADR and update `docs/api-endpoints.md` section 9.

---

## 9. What we still have to build (our side)

| Item | Where | Notes |
|---|---|---|
| RabbitMQ client dependency + config | `src/messaging`, `src/configuration` | **Done**: `amqp-connection-manager`, `RABBITMQ_URL`, `OUTBOX_RELAY_BATCH` |
| Outbox relay job | `src/jobs` | **Done**: envelope (section 3.3), publisher confirms, ordered retries |
| Real `OutboxService` / `InboxService` | `src/messaging` | **Done**. The inbox row and the handler share one transaction. |
| Library integration module | `src/integrations/library` | **Done** for phase 1: consumer, sync service, repair job, LMS client. Link endpoints are phase 2. |
| `booking.alert_due`, `external` block, `cancelReason` | `NotificationDispatcher`, `BookingActivityService` | Section 4.2 |
| Consumer framework | `src/messaging/consumers` | **Done** |
| `seat.status_changed` event | `SeatsService` | Currently a `shortcut:` comment |
| API-key auth for `api_clients` + scopes guard | `src/api-clients` | **Done** (`@ClientSecured`), `@UserOrClient` still to do |
| RabbitMQ service in Docker Compose | `infrastructure/` | **Done** (dev), plus `infrastructure/rabbitmq/setup-dev.sh` |
| Tests | `test/e2e` | Outbox row per change (exists), relay publishes once, duplicate message processed once, poison message to DLQ |

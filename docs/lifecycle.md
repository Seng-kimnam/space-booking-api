# Space Booking: system lifecycle and workflows

How the whole platform works, from boot to booking to partner sync.
Each section is one panel for a later PNG infographic. Diagrams are Mermaid.

**Legend:** ✅ implemented · 🟡 partly implemented / interim · ⏳ planned (not in code)

Sources: `src/**`, `docs/erd.md`, `docs/integration/*`, [`docs/external-doc.md`](./external-doc.md).
All routes are prefixed with `/api/v1`. All times are UTC `timestamptz`.

---

## 1. System at a glance

```mermaid
flowchart LR
  subgraph Actors
    U[User]
    A[Admin]
    SA[Super admin]
    LMS[LMS<br/>external system]
    TG[Telegram]
  end
  subgraph API[Space Booking API · NestJS]
    AUTH[auth / users / roles]
    CAT[places / areas / seats]
    BK[bookings<br/>+ attendance + QR]
    NOTIF[notifications]
    TGM[telegram]
    MSG[messaging<br/>outbox · inbox · consumer]
    INT[integrations/library]
    APIC[api-clients]
    EXT[external-identities]
    JOBS[jobs · cron]
  end
  DB[(PostgreSQL 17)]
  MQ{{RabbitMQ}}
  SMTP[(SMTP / Mailpit)]

  U & A & SA -->|JWT| API
  LMS -->|HTTP + x-api-key| APIC --> INT
  INT -->|HTTP x-api-key, jobs only| LMS
  MSG <-->|AMQP| MQ <-->|AMQP| LMS
  NOTIF --> TGM -->|Bot API| TG
  TG -->|webhook| TGM
  AUTH -->|OTP mail| SMTP
  API --- DB
  JOBS --> BK & NOTIF & MSG & INT
```

| Layer | Modules | Status |
|---|---|---|
| Identity | `auth`, `users` (entities), `roles`, `api-clients`, `external-identities` | ✅ (`UsersController` is an unimplemented scaffold 🟡) |
| Catalog | `places` (+ policy, hours, closures), `areas`, `seats` | ✅ |
| Booking | `bookings` (create/modify/extend/cancel, QR, attendance, lifecycle) | ✅ |
| Delivery | `notifications` (Telegram channel only), `telegram` | ✅ |
| Integration | `messaging`, `integrations/http`, `integrations/library` | ✅ (LMS only) |
| Ops | `jobs`, `logger`, `configuration`, `database` | ✅ |
| Not present | Seat availability endpoints (`/seats/available`, `/seats/:id/availability`), `health/` module, Redis usage, `auth_identities` usage, booking on behalf of partner members | ⏳ |

---

## 2. Application lifecycle

```mermaid
flowchart TB
  B1[Boot: main.ts] --> B2[env.validation.ts<br/>fail fast on bad env]
  B2 --> B3[TypeORM connect<br/>synchronize: false · migrations only]
  B3 --> B4[Modules init]
  B4 --> B5{RABBITMQ_URL set?}
  B5 -- yes --> B6[Publisher declares space-booking.events]
  B5 -- no --> B7[Messaging off · outbox rows wait]
  B6 --> B8{LIBRARY_INTEGRATION_ENABLED?}
  B8 -- yes --> B9[Wait for library.events → declare queues → consume]
  B4 --> B10[Telegram webhook registrar]
  B4 --> B11[Cron jobs start]
  B11 --> R[Serve HTTP requests]
```

**Background jobs** (`src/jobs/`, `src/integrations/library/jobs/`):

| Job | Every | Does |
|---|---|---|
| `outbox-relay` | 5 s | Publishes `outbox_events` to RabbitMQ (no-op without a broker) |
| `notification-dispatch` | 30 s | Sends due `notifications` via Telegram, retries with backoff (1, 2, 4 … 60 min) |
| `expire-bookings` | 1 min | `PENDING` past start + grace → `EXPIRED`, counts a no-show |
| `overdue-checkouts` | 1 min | `CHECKED_IN` past end + `overdue_alert_minutes` → `CHECKOUT_OVERDUE` |
| `auth-cleanup` | 1 h | Deletes OTPs and refresh tokens one day after they expire |
| `lms-place-repair` | 1 h | Re-pulls 50 LMS place snapshots over HTTP (no-op without `LMS_BASE_URL`) |

**Core guarantees** (AGENTS.md §6):
- No double-booking: the DB exclusion constraint `no_double_booking` rejects overlaps (`23P01` → `409`). There is no "check then insert".
- Every booking change commits in **one transaction** with its `booking_events`, `notifications` and `outbox_events` rows.
- Policy values come from `booking_policies`, one row per place. Defaults:

  | Policy | Default |
  |---|---|
  | `checkin_grace` | 15 min |
  | `late_checkin_alert` | 5 min |
  | `checkout_reminder` | 15 min |
  | `overdue_alert` | 15 min |
  | Booking length (min–max) | 30–240 min |
  | `slot` | 15 min |
  | `max_advance_days` | 7 |
  | `max_active_per_user` | 1 |
  | `max_extensions` | 2 |
  | `modify_cutoff` | 30 min |

---

## 3. User journey

```mermaid
flowchart LR
  R[Register] --> V[Verify email OTP] --> L[Login] --> BR[Browse places · areas · seats]
  BR --> BK[Book seat(s)] --> Q[Get check-in QR] --> CI[Check in] --> CO[Check out]
  BK -.-> M[Modify / Extend / Cancel]
  L -.-> TGL[Link Telegram]
  L -.-> LMSL[Link LMS member]
  BK & CI & CO -.-> N[Telegram alerts]
```

### 3.1 Registration and authentication ✅

| Step | Route | Notes |
|---|---|---|
| Register | `POST /auth/register` | Role `USER` or `ADMIN`. An ADMIN request is stored as a USER with `admin_request_status = PENDING`. `SUPER_ADMIN` is refused. The response is the same whether or not the email exists |
| Verify | `POST /auth/verify-email`, `POST /auth/resend-otp` | OTP sent by email (`MailService`), hash only, limited attempts |
| Login | `POST /auth/login` | Needs a verified email, an active account and no pending admin request. Returns access and refresh tokens |
| Refresh | `POST /auth/refresh-token` | Rotation; re-using an old token revokes **all** of that user's sessions |
| Session | `GET /auth/me`, `PATCH /auth/change-password`, `POST /auth/logout`, `POST /auth/logout-all` | |
| Password reset | `POST /auth/forgot-password` → `POST /auth/reset-password` | Email OTP |
| Google 🟡 | `GET /auth/google` → `/auth/google/callback` | Finds the user by `googleId`, links an existing email if Google verified it, or creates a USER. Issues an **access token only**, without the login checks above |

Auth routes are rate-limited (`src/auth/auth-throttle.ts`).

```mermaid
sequenceDiagram
  actor U as User
  participant API as AuthController
  participant DB as Postgres
  participant M as SMTP
  U->>API: POST /auth/register
  API->>DB: insert user (unverified) + user_otps (hash)
  API->>M: send OTP
  U->>API: POST /auth/verify-email {otp}
  API->>DB: mark OTP used, email_verified_at
  U->>API: POST /auth/login
  API->>DB: insert refresh_tokens (hash)
  API-->>U: accessToken + refreshToken
```

### 3.2 Browsing ✅ (public, no login)

- `GET /places`, `GET /places/:placeId`: active places only.
- `GET /places/:placeId/areas`.
- `GET /seats`, `GET /seats/:seatId`, `GET /places/:placeId/seats`.
- Availability is **derived from bookings**; there is no `is_available` column. Dedicated availability endpoints are ⏳.

### 3.3 Booking ✅ (`USER` role)

| Action | Route | Rule |
|---|---|---|
| Book | `POST /bookings` | One or more seats of one place, same time, all-or-nothing (`group_id`). Optional `Idempotency-Key`. Checks: policy, opening hours and closures, `max_active_per_user`, LMS eligibility (§6.3) |
| List | `GET /bookings`, `/bookings/upcoming`, `/bookings/history`, `/bookings/:bookingId` | Own bookings only |
| Modify | `PATCH /bookings/:bookingId` | `PENDING` only, before start − `modify_cutoff` |
| Extend | `POST /bookings/:bookingId/extend` | `PENDING` or `CHECKED_IN`, up to `max_extensions` and `max_minutes` |
| Cancel | `POST /bookings/:bookingId/cancel` | `PENDING` only, before the cutoff. The row is kept and the seat freed |
| QR | `GET /bookings/:bookingId/qr-code` | One-time check-in or check-out QR (per seat or per group); reissuing revokes the previous one |
| Status | `GET /bookings/:bookingId/check-in-status` | Attendance state and check-in window |

### 3.4 Check-in / check-out ✅

- `POST /check-in/scan` and `POST /check-out/scan` (`USER` or `ADMIN`) take the QR text.
- Check-in is accepted from shortly before the start until start + `checkin_grace`.
- Only staff may scan another user's QR.
- Check-out by QR also closes a forgotten (`CHECKOUT_OVERDUE`) checkout.
- The QR token is marked used in the same transaction as the status change.

### 3.5 Notifications ✅ (Telegram) · email for auth only

1. **Link Telegram:** `POST /telegram/link` returns a `t.me` deep link with a one-time code. The user opens it, Telegram calls `POST /webhooks/telegram` (secret-guarded), and the account is linked. `GET /telegram/status`, `DELETE /telegram/unlink`.
2. **Alerts** are written as `notifications` rows inside the booking transaction, and the dispatcher sends them later. Several seats of one booking go out as one message.

| Alert | When |
|---|---|
| `BOOKING_CONFIRMED` | Right after booking |
| `LATE_CHECKIN` | start + `late_checkin_alert` |
| `CHECKOUT_REMINDER` | end − `checkout_reminder` |
| `BOOKING_MODIFIED`, `BOOKING_EXTENDED`, `CHECKED_IN`, `CHECKED_OUT`, `BOOKING_CANCELLED` | On the change |
| `BOOKING_EXPIRED` | On expiry |
| `FORGOTTEN_CHECKOUT` | On becoming overdue |

Alerts that no longer apply become `SKIPPED`. A modify or extend reschedules the pending ones.

---

## 4. Admin journey

| Area | Routes | Notes |
|---|---|---|
| Places ✅ | `POST /admin/places`, `PATCH /admin/places/:placeId`, `DELETE …` | Creates the place with its booking policy, opening hours and closures. Soft delete. For LMS-managed places, LMS-owned fields return `409`; admins keep `isActive` and the policy |
| Areas ✅ | `POST /admin/places/:placeId/areas`, `PATCH/DELETE /admin/areas/:areaId` | LMS-owned areas: `409` |
| Seats ✅ | `POST /admin/places/:placeId/seats`, `PATCH /admin/seats/:seatId`, `PATCH …/status` (`ACTIVE`/`MAINTENANCE`/`UNAVAILABLE`), `DELETE` | Deleting a seat with live bookings returns `409`. Soft delete |
| Bookings ✅ | `GET /admin/bookings`, `GET /admin/bookings/:bookingId` (with event history) | |
| | `PATCH /admin/bookings/:bookingId/status` | Cancel any `PENDING` booking without the cutoff, or resolve an overdue checkout |
| | `POST …/check-in`, `POST …/check-out` | Manual, without a QR |
| Users ✅ | `POST /admin/users/:userId/suspend`, `…/reactivate` | Suspending revokes sessions; role hierarchy enforced |
| Admin requests ✅ | `GET /auth/admin-requests`, `POST …/:userId/approve`, `…/reject` | `SUPER_ADMIN` only |
| Roles ✅ | `/admin/roles` CRUD | |
| API clients ✅ | `/admin/api-clients` (create, list, get, update, `rotate-key`) | Partner keys, shown once |
| LMS ✅ | `POST /admin/integrations/library/places/:placeId/resync` | Pull a place from LMS now |
| Users CRUD 🟡 | `/users` | Unimplemented Nest scaffold (ADMIN-only) |

```mermaid
flowchart LR
  A[Admin] --> P[Create place<br/>+ policy · hours · closures] --> AR[Add areas] --> S[Add seats] --> GO[Activate place] --> OPS[Operate: bookings ·<br/>manual check-in/out · overdue]
  SA[Super admin] --> APR[Approve admin requests]
  A --> SUS[Suspend / reactivate users]
  A --> KEY[Issue partner API keys]
```

---

## 5. Booking lifecycle ✅

`src/bookings/domain/booking-state.ts`:

```mermaid
stateDiagram-v2
  [*] --> PENDING: POST /bookings
  PENDING --> CHECKED_IN: QR scan / admin check-in
  PENDING --> CANCELLED: user (before cutoff) · admin · LMS place change
  PENDING --> EXPIRED: job: no check-in by start + grace (no-show++)
  CHECKED_IN --> COMPLETED: QR / admin check-out
  CHECKED_IN --> CHECKOUT_OVERDUE: job: end + overdue_alert passed
  CHECKOUT_OVERDUE --> COMPLETED: QR check-out · admin resolve
  COMPLETED --> [*]
  CANCELLED --> [*]
  EXPIRED --> [*]
```

| Group | Statuses | Meaning |
|---|---|---|
| Holds the seat | `PENDING`, `CHECKED_IN`, `CHECKOUT_OVERDUE` | Covered by `no_double_booking` |
| Counts as active | `PENDING`, `CHECKED_IN` | Counted against `max_active_per_user` |
| Final | `COMPLETED`, `CANCELLED`, `EXPIRED` | No further changes |

Seat status is never changed by bookings.

**One booking change = one transaction:**

```mermaid
flowchart LR
  C[Change booking] --> T{{DB transaction}}
  T --> B[(bookings)]
  T --> E[(booking_events<br/>audit)]
  T --> N[(notifications<br/>Telegram later)]
  T --> O[(outbox_events<br/>booking.* later)]
```

| Status change | `booking_events` | Routing key |
|---|---|---|
| create | `CREATED` | `booking.created` |
| modify | `MODIFIED` | `booking.modified` |
| extend | `EXTENDED` | `booking.extended` |
| cancel | `CANCELLED` | `booking.cancelled` |
| check-in | `CHECKED_IN` | `booking.checked_in` |
| check-out | `CHECKED_OUT` | `booking.checked_out` |
| expire | `EXPIRED` | `booking.expired` |
| overdue | `OVERDUE` | `booking.checkout_overdue` |

Reminders that are not status changes (late check-in, checkout reminder, forgotten checkout) are published as `booking.alert_due` when they become due.

---

## 6. External integration lifecycle (LMS) ✅

Details: [`docs/external-doc.md`](./external-doc.md).

```mermaid
flowchart LR
  subgraph LMS
    LO[(LMS outbox)]
    LAPI[LMS REST]
  end
  subgraph SB[Space Booking]
    CONS[LibraryEventsConsumer]
    SYNC[LibraryPlaceSyncService]
    LINK[LibraryLinksService]
    OB[(outbox_events)]
    REL[Outbox relay]
    REP[Place repair job]
  end
  LO -->|library.events<br/>place.created/updated<br/>member.standing_changed| CONS
  CONS --> SYNC & LINK
  SYNC & LINK --> OB --> REL -->|space-booking.events<br/>booking.* · place.sync_* · identity.*| LMS
  REP -->|GET /external/places/:id/snapshot| LAPI
  LMS -->|x-api-key: link-requests · links · places status| SB
```

### 6.1 Account linking ✅

```mermaid
sequenceDiagram
  participant L as LMS
  participant API as Space Booking
  actor U as User (logged in)
  participant MQ as RabbitMQ
  L->>API: POST /integrations/library/link-requests {memberId} (x-api-key, identities:link)
  API-->>L: one-time code + linkUrl? (hash stored, TTL 10 min)
  L-->>U: shows code / link
  U->>API: POST /integrations/library/my-link {code} (JWT)
  API->>API: consume code · insert external_identities · outbox identity.linked (1 tx)
  API-->>U: {system, memberId, linkedAt, eligible}
  API--)MQ: identity.linked
  Note over L,U: Unlink: DELETE /integrations/library/links/:memberId (LMS)<br/>or DELETE /integrations/library/my-link (user) → identity.unlinked
```

- One LMS member links to one user, never matched by email (D11).
- `409` if either side is already linked.

### 6.2 Place synchronization ✅

```mermaid
sequenceDiagram
  participant L as LMS
  participant MQ as RabbitMQ
  participant C as ConsumerRunner
  participant S as LibraryPlaceSyncService
  participant DB as Postgres
  L->>MQ: place.created / place.updated (full snapshot, revision)
  MQ->>C: deliver (space-booking.library-events)
  C->>C: trust check (user_id) · envelope + schema
  C->>DB: BEGIN · insert inbox_events (dedupe)
  C->>S: apply(snapshot)
  alt stale revision
    S-->>C: ignore
  else breaks rules
    S->>DB: outbox place.sync_rejected
  else ok
    S->>DB: place · hours · future closures · areas · seats
    S->>DB: cancel impossible future PENDING bookings
    S->>DB: outbox place.sync_applied (+ booking.cancelled)
  end
  C->>DB: COMMIT
  C->>MQ: ack (transient error → .retry · poison → .dlq)
```

- New LMS places start **inactive** until our admin activates them.
- A safety net, the hourly repair job and the admin resync, pulls the same snapshot over HTTP.
- LMS can read sync status with `GET /integrations/library/places/:placeId` (`places:read`).

### 6.3 Eligibility check ✅

```mermaid
flowchart LR
  MS[member.standing_changed] --> ST[(external_identities<br/>standing_eligible · reasons · expiry)]
  B[POST /bookings at LMS place] --> Q{Linked AND standing known?}
  Q -- no --> OK[Allowed]
  Q -- yes --> E{eligible AND not expired?}
  E -- yes --> OK
  E -- no --> F[403]
```

- Only **new** bookings are checked; existing ones are kept (D10).
- Standing that is older than what we have, or that belongs to an unlinked member, is ignored.

### 6.4 Booking events to LMS ✅

- Every `booking.*` envelope is published to `space-booking.events`.
- For LMS places it carries `external: { system, placeId, seatId, memberId }`; for other places `external` is null.
- Delivery is at least once and in `occurred_at` order; consumers dedupe on `message_id`.

### 6.5 RabbitMQ communication rules ✅

- Each system publishes only to its own exchange: `space-booking.events` and `library.events`.
- A consumer owns its queue.
- Sender proof is the broker-validated `user_id`, which must equal `app_id` and `source`.
- Every message is a versioned envelope validated against a JSON Schema on both send and receive (`src/messaging/contract/`).
- Failures: retry queue with TTL, then `.dlq` after `RABBITMQ_MAX_ATTEMPTS` or for poison messages.

---

## 7. Integrating a future partner

What is already generic, and what a new partner (for example a coworking operator) would need:

| Building block | Generic today? | To add a partner |
|---|---|---|
| API keys + scopes (`api-clients`) | ✅ any system | Issue a key; add scopes to `API_CLIENT_SCOPES` if needed |
| Outbox / inbox / `ConsumerRunner` | ✅ partner-agnostic | Add a `ConsumerRoute` (queue + partner exchange + handlers) |
| `ServiceHttpClient` | ✅ | Wrap it in a partner client (like `LmsClient`) |
| `places.external_system`, `external_identities.external_system` | ✅ free-text columns | Use a new system name |
| Admin edit lock for externally managed places | ✅ any `external_system` | none |
| Booking eligibility check | ✅ uses the place's `external_system` | Feed standing into `external_identities` |
| Message contract (`schemas.ts`, `types.ts`) | ❌ allows only `source: space-booking \| library` and `system: library` | Widen the enums; add the partner's message schemas |
| `external` block in `booking.*` events | ❌ hard-coded to `'library'` (`booking-activity.service.ts`, `booking-alert-events.ts`) | Make it per-system |
| Integration module | ❌ LMS-specific | New `src/integrations/<partner>/` following `library/` |
| Booking on behalf of a partner member (`@UserOrClient`, `X-External-User`, scopes `bookings:read/write`) | ⏳ scopes defined, no routes | Planned phase 3 |

```mermaid
flowchart LR
  P[New partner] --> K[1. API key + scopes]
  K --> X[2. Exchange + broker user<br/>partner.events]
  X --> R[3. ConsumerRoute + handlers<br/>src/integrations/partner/]
  R --> C[4. Contract: schemas · fixtures · enums]
  C --> I[5. Link accounts via external_identities]
  I --> E[6. Receive booking.* from space-booking.events]
```

---

## 8. Module interactions

```mermaid
flowchart TB
  AUTH[auth] --> USERS[users entities]
  CAT[places · areas · seats] -->|ports| BK[bookings]
  BK --> NOTIF[notifications]
  BK --> MSG[messaging · OUTBOX port]
  BK --> EXT[external-identities]
  NOTIF --> TG[telegram]
  TG --> MSG2[messaging · INBOX port]
  INT[integrations/library] --> CAT & BK & EXT & MSG & APIC[api-clients]
  JOBS[jobs] --> BK & NOTIF & MSG
```

- **Ports** (injection token + interface) decouple modules: `bookings.ports.ts` (seats, place rules, outbox, no-show counter) and `telegram.ports.ts` (link codes, inbox).
- ✅ The no-show counter is `UsersService.incrementNoShow` and Telegram link codes are `OtpService` (users module).

| Actor | Talks to | Through |
|---|---|---|
| User | auth, catalog, bookings, attendance, telegram, my-link | REST + JWT |
| Admin / Super admin | admin-* controllers | REST + JWT + role |
| LMS | link-requests, links, place status | REST + `x-api-key` + scope |
| LMS | consumer / publisher | RabbitMQ (`library.events` ⇄ `space-booking.events`) |
| Telegram | webhook | `X-Telegram-Bot-Api-Secret-Token` guard |
| Scheduler | jobs | `@nestjs/schedule` cron |

---

## 9. Infographic outline (for the PNG)

1. **Top band:** actors (User, Admin, Super admin, LMS, Telegram) around the API, with Postgres and RabbitMQ below (§1).
2. **Left column:** user journey, Register → Verify → Login → Browse → Book → QR → Check-in → Check-out, with Telegram alerts as side bubbles (§3).
3. **Center:** booking state machine (§5) with the "one transaction" fan-out.
4. **Right column:** admin setup, Place → Areas → Seats → Activate → Operate (§4).
5. **Bottom band:** LMS lifecycle, Link → Sync → Eligibility → Events, with the exchanges and queues (§6).
6. **Footer:** cron jobs (§2) and the future-partner checklist (§7), with the legend ✅ 🟡 ⏳.

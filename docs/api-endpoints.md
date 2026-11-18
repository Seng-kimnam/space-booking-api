# API Endpoints

Based on the team draft v1.0 (4 Nov 2026), with `/libraries` renamed to `/places` (the app is generic; a library is one place type). All paths are relative to `/api/v1`.

**Access:** Public = no login. Signed-in = any role with a valid JWT. USER / ADMIN = JWT with that role; **SUPER_ADMIN also passes every ADMIN route** (`RolesGuard`). SUPER_ADMIN = that role only. API key = `api_clients` key with the listed scope (sync integration). Telegram = Telegram calling with the webhook secret header.

**List endpoints** (shared base: `src/common/dto/pagination-query.dto.ts`, `src/common/utils/pagination.ts`):
- `page` (>= 1, default 1) and `limit` (1..100, default 20). Responses are `{ items, page, limit, total }`.
- Sortable lists also take `sortBy` (allowlist per endpoint, below) and `order` (`ASC` | `DESC`). Without `sortBy` the endpoint's default order applies, and `order` alone flips it; any other `sortBy` without `order` is `ASC`. Ties are broken by id, so pages are stable.
- Unknown query params, and a `sortBy` outside the allowlist, are rejected with `400`.

| List | `sortBy` | Default order | Filters |
|---|---|---|---|
| GET /places | `name`, `createdAt` | `name` ASC | `type`, `search` (name, case-insensitive) |
| GET /places/:placeId/areas | `name`, `createdAt` | `name` ASC | |
| GET /seats | `label`, `createdAt` | place, then `label` ASC | `placeId`, `areaId`, `status`, `search` (label, case-insensitive) |
| GET /places/:placeId/seats | `label`, `createdAt` | `label` ASC | `areaId`, `status`, `search` |
| GET /seats/available | not sortable | `label` ASC | `placeId`, `startAt`, `endAt` (required), `areaId` |
| GET /bookings | `startAt`, `createdAt` | `createdAt` DESC | `view` (`all` \| `upcoming` \| `history`), `status`, `placeId`, `from`, `to` |
| GET /bookings/upcoming | `startAt`, `createdAt` | `startAt` ASC | `status`, `placeId`, `from`, `to` |
| GET /bookings/history | `startAt`, `createdAt` | `startAt` DESC | `status`, `placeId`, `from`, `to` |
| GET /admin/bookings | `startAt`, `createdAt` | `startAt` DESC | `status`, `userId`, `seatId`, `placeId`, `from`, `to` |
| GET /admin/users | `createdAt`, `name`, `email` | `createdAt` DESC | `role`, `isActive`, `deleted`, `adminRequestStatus`, `q` |
| GET /admin/roles | `id`, `name` | `id` ASC | `search` |
| GET /admin/api-clients | `name`, `createdAt` | `name` ASC | |
| GET /users/me/notifications, /users/me/activity (and the `/admin/users/:userId/...` versions) | not sortable | newest first | |

Booking `from` / `to` select bookings whose range overlaps `[from, to)` (UTC ISO 8601; either side may be omitted). `from` after `to` is `400`. With `/bookings/upcoming` or `/history`, `status` narrows the view's statuses (a status outside the view returns no rows).

## 1. Authentication
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | POST | /auth/register | Register account with roleId; ADMIN requires SUPER_ADMIN approval | Public |
| 2 | POST | /auth/verify-email | Verify email with OTP | Public |
| 3 | POST | /auth/resend-otp | Resend verification OTP | Public |
| 4 | POST | /auth/login | Login | Public |
| 5 | POST | /auth/refresh-token | Refresh access token | Public |
| 6 | POST | /auth/forgot-password | Send password reset OTP | Public |
| 7 | POST | /auth/reset-password | Reset password | Public |
| 8 | POST | /auth/logout | Logout (revoke the caller's own refresh token) | Signed-in |
| 8a | POST | /auth/logout-all | Log out everywhere (revoke all the caller's refresh tokens) | Signed-in |
| 8b | GET | /auth/admin-requests | List pending admin registrations | SUPER_ADMIN |
| 8c | POST | /auth/admin-requests/:userId/approve | Approve a pending admin registration | SUPER_ADMIN |
| 8d | POST | /auth/admin-requests/:userId/reject | Reject a pending admin registration | SUPER_ADMIN |
| 8e | POST | /admin/users/:userId/suspend | Suspend an account (204): login and refresh refused, all refresh tokens revoked. ADMIN may suspend USERs; SUPER_ADMIN also ADMINs; never a SUPER_ADMIN or yourself | ADMIN |
| 8f | POST | /admin/users/:userId/reactivate | Reactivate a suspended account (204). Same rules as 8e | ADMIN |
| 8g | GET | /admin/users | List accounts (paginated, sortable). Filters: `role`, `isActive`, `deleted`, `adminRequestStatus`, `q` (case-insensitive substring of name or email). Newest first by default | ADMIN |
| 8h | GET | /admin/users/:userId | One account with sign-in methods, links and booking stats (`404` if unknown) | ADMIN |
| 9 | GET | /auth/me | Current user profile | Signed-in |
| 10 | PATCH | /auth/change-password | Change password | Signed-in |
| 10a | GET | /auth/google | Start Google sign-in: 302 to Google's consent screen | Public |
| 10b | GET | /auth/google/callback | Google redirects here; responds with the same JSON as `/auth/login` | Provider |
| 10c | GET | /auth/facebook | Start Facebook sign-in: 302 to Facebook (rate limited like login) | Public |
| 10d | GET | /auth/facebook/callback | Facebook redirects here; responds like `/auth/login`, or with a message when the new account must verify its email by OTP first | Provider |
| 11 | GET | /auth/oauth/:provider | **Planned, not built.** Start sign-in: 302 redirect to Google / Facebook consent screen | Public |
| 12 | GET | /auth/oauth/:provider/callback | **Planned, not built.** OAuth callback; 302 back to the client app | Provider |
| 13 | POST | /auth/oauth/exchange | **Planned, not built.** Swap the one-time login code from the callback for our tokens | Public |
| 14 | POST | /auth/oauth/complete-signup | **Planned, not built.** Finish sign-up when the provider shared no email | Public |
| 15 | POST | /auth/oauth/:provider/token | **Planned, not built.** Sign in with a provider token (mobile / native SDK flow) | Public |
| 16 | GET | /auth/identities | **Planned, not built.** List linked Google / Facebook accounts | Signed-in |
| 17 | POST | /auth/identities/:provider/link | **Planned, not built.** Start linking: returns the provider authorization URL | Signed-in |
| 18 | DELETE | /auth/identities/:provider | **Planned, not built.** Unlink (rejected if it is the last sign-in method) | Signed-in |

`:provider` is `google` or `facebook`. Routes 10a–10d use passport and are hidden from Swagger. `GET /auth/admin-only` (ADMIN) is a role-guard smoke test that returns a fixed message.

### My account (`/users/me`)
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 9a | PATCH | /users/me | Update my profile: `{ name?, avatarUrl? }` (`avatarUrl` https, `null` clears it). Role, email and status can't be changed here (`400`) | USER, ADMIN |
| 9b | GET | /users/me | My profile, sign-in methods, linked accounts, `pendingEmail` | USER, ADMIN |
| 9c | DELETE | /users/me | Close my account (204) `{ password? }`: pending bookings cancelled, signed out everywhere, email stays reserved (an admin can restore). `409` while checked in | USER, ADMIN |
| 9d | GET | /users/me/summary | My booking statistics | USER, ADMIN |
| 9e | POST | /users/me/email | Start an email change (202) `{ newEmail, password? }`: an `EMAIL_CHANGE` code is mailed to the new address. Same answer whether or not the address is free | USER, ADMIN |
| 9f | POST | /users/me/email/confirm | Confirm with `{ otp }`; returns the profile. `409` if the address was taken meanwhile | USER, ADMIN |
| 9g | GET | /users/me/sessions | Devices where I am signed in (`current` marks this one) | USER, ADMIN |
| 9h | DELETE | /users/me/sessions/:sessionId | Sign out one device (204) | USER, ADMIN |
| 9i | GET | /users/me/notifications | My alert history (Telegram, email), paginated | USER, ADMIN |
| 9j | GET | /users/me/activity | History of my bookings (created, modified, checked in, ...), paginated | USER, ADMIN |

`password` is required for accounts with a password and not needed for Google-only accounts.

### Admin: accounts and roles
Who may act on whom (`src/users/policies/account-policy.ts`): ADMIN → USERs; SUPER_ADMIN → USERs and ADMINs; nobody acts on a SUPER_ADMIN.

| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 8i | GET | /admin/users/stats | Account statistics for the dashboard | ADMIN |
| 8j | POST | /admin/users | Create an account `{ name, email, role? }` (email marked verified; the user gets a code to set their password). ADMIN accounts only by a SUPER_ADMIN. `409` email in use | ADMIN |
| 8k | PATCH | /admin/users/:userId | Edit name/avatar or `resetNoShowCount`. `409` if closed | ADMIN |
| 8l | PATCH | /admin/users/:userId/role | Change role `{ role }`; signs the user out everywhere | SUPER_ADMIN |
| 8m | DELETE | /admin/users/:userId | Close an account (204): pending bookings cancelled, sessions revoked. `409` while the user has a seat in use | ADMIN |
| 8n | POST | /admin/users/:userId/restore | Reopen a closed account (204) | ADMIN |
| 8o | POST | /admin/users/:userId/verify-email | Mark the email as verified (204, support case) | ADMIN |
| 8p | GET | /admin/users/:userId/sessions | The user's signed-in devices | ADMIN |
| 8q | POST | /admin/users/:userId/revoke-sessions | Sign the user out everywhere without suspending (204) | ADMIN |
| 8r | GET | /admin/users/:userId/notifications | The user's alert history, including delivery errors | ADMIN |
| 8s | GET | /admin/users/:userId/activity | Audit trail of booking events by or about the user | ADMIN |
| 8t | POST | /admin/roles | Create a role | ADMIN |
| 8u | GET | /admin/roles | List roles (paginated, `search`) | ADMIN |
| 8v | GET | /admin/roles/:id | Get one role | ADMIN |
| 8w | PATCH | /admin/roles/:id | Rename a role | ADMIN |
| 8x | DELETE | /admin/roles/:id | Delete a role (204) | ADMIN |

- **Admin requests:** registering with the ADMIN `roleId` stores the account as `USER` with `admin_request_status = PENDING`. The email must be verified with the OTP like any account; only verified requests are listed (8b) or can be approved/rejected. Login returns `403` while pending. Approve (8c) grants ADMIN; reject (8d) leaves a normal `USER` account.
- **No account enumeration:** register, verify-email, resend-otp, forgot-password and reset-password answer a known and an unknown email with the same status and body; login uses one message for unknown email and wrong password. Register no longer returns `409` for a taken email.
- **Sessions:** refresh tokens rotate on every use. Re-presenting a rotated token more than 10 s later revokes all the user's sessions. Suspended (8e), unverified and pending accounts can't log in or refresh. Access tokens are HS256 JWTs `{ sub, role }` with issuer/audience `space-booking-api`.
- **Rate limits** (`src/auth/auth-throttle.ts`): routes 1–7 return `429` when over the limit. Two counters per route: per client IP and per email in the body (refresh falls back to the IP). Login 10/min per IP and 10 per 15 min per account; register, resend-otp and forgot-password 5/min per IP and 3 per 15 min per account; verify-email and reset-password 10/min and 10 per 15 min; refresh 30/min per IP. In-memory store, so limits are per instance.
- **OTP rules:** at most 5 attempts per code (counted atomically, so parallel guesses can't exceed it), single use, 10-minute expiry, and no new code is mailed within 60 s of the last one (the response is the same either way).

### Social sign-in flows

> **Planned design, not built yet** (routes 11–18). What runs today is 10a–10d: a plain passport redirect whose callback answers with the tokens as JSON.

**A. Redirect flow with callback (web)**, Authorization Code + PKCE:

```
Client app            Space Booking API                     Google / Facebook
    |  GET /auth/oauth/google?redirect_uri=https://app/x       |
    |------------------------->|  create state, nonce, PKCE     |
    |                          |  (Redis, TTL 10 min)           |
    |<---- 302 to provider ----|                                |
    |---------------------- user signs in, consents ----------->|
    |                          |<-- GET /auth/oauth/google/callback?code&state
    |                          |  check + delete state          |
    |                          |  exchange code (client secret) |
    |                          |-------------------------------->|
    |                          |<---- ID token / profile -------|
    |                          |  verify, find/link/create user |
    |                          |  one-time login code (Redis, 60 s)
    |<- 302 https://app/x?code=<login code> ---|                 |
    |  POST /auth/oauth/exchange { code }      |                 |
    |------------------------->|  delete code, issue tokens     |
    |<-- { accessToken, refreshToken, user } --|                 |
```

- `redirect_uri` must exactly match an entry in `OAUTH_ALLOWED_REDIRECT_URIS` (no open redirect). It is stored with the state, never read again from the callback query.
- `state` is random, single use, 10-minute TTL. A missing, expired or reused state fails the callback.
- Google: the `nonce` is checked inside the ID token. PKCE is used for both providers.
- **Tokens never appear in a URL.** The callback only sends back a one-time login code (single use, 60 s TTL), which the client swaps via `POST /auth/oauth/exchange`.
- Callback errors redirect to `redirect_uri?error=<code>`: `access_denied` (user cancelled), `invalid_state`, `provider_error`, `account_exists` (the email matches an existing account but is not verified by the provider, so sign in with password and link), `account_inactive`.

**B. Token flow (mobile / native SDK)**: the app completes the provider login with the platform SDK and sends `POST /auth/oauth/:provider/token` with `{ idToken }` (Google) or `{ accessToken }` (Facebook). Same verification and account rules, same response as `/auth/login`. No callback involved.

**C. Linking from a signed-in account**: `POST /auth/identities/:provider/link` (JWT required) returns `{ authorizationUrl }`. The client opens it. The state stores `intent = LINK` and the user id, so the same callback links the identity to that user instead of signing in, then redirects to `redirect_uri?linked=<provider>`. If the social account already belongs to another user, it redirects with `error=identity_in_use`.

**Exchange / complete-signup responses**
- Normal: `{ accessToken, refreshToken, user }`, same as `/auth/login`.
- Provider shared no email (Facebook can omit it): `{ status: "EMAIL_REQUIRED", signupTicket }`. The client asks the user for an email and calls `POST /auth/oauth/complete-signup { signupTicket, email }`. The account is created unverified, an OTP is sent, and sign-in completes after `/auth/verify-email`. If the email already belongs to an account, the usual "sign in and link" rule applies (`409`). The ticket is stored in Redis, single use, 15-minute TTL.

**Other notes**
- A social-only user (no password yet) sets a first password through forgot/reset password (email OTP). `change-password` always requires the current password.
- Env vars in use (10a–10d): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_CALLBACK_URL`. Proposed for the planned flow: `OAUTH_ALLOWED_REDIRECT_URIS` (comma-separated). The callback URLs must also be registered in the Google Cloud and Meta developer consoles.

## 2. Places and areas
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | GET | /places | List / search places (`type`, `search`; sortable) | Public |
| 2 | GET | /places/:placeId | Place details (incl. opening hours) | Public |
| 3 | GET | /places/:placeId/areas | Areas of a place (sortable) | Public |
| 4 | GET | /places/:placeId/seats | Seats in a place (`areaId`, `status`, `search`; sortable) | Public |
| 5 | POST | /admin/places | Create place (+ default policy) | ADMIN |
| 6 | PATCH | /admin/places/:placeId | Update place, opening hours, closures, policy | ADMIN |
| 7 | DELETE | /admin/places/:placeId | Soft-delete place | ADMIN |
| 8 | POST | /admin/places/:placeId/areas | Create area | ADMIN |
| 9 | PATCH | /admin/areas/:areaId | Update area | ADMIN |
| 10 | DELETE | /admin/areas/:areaId | Soft-delete area | ADMIN |

## 3. Seats
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | GET | /seats | List seats (filter by place, area, status, label `search`; sortable) | Public |
| 2 | GET | /seats/available | Available seats of a place for a time window: `?placeId&startAt&endAt[&areaId][&page&limit]` | Public |
| 3 | GET | /seats/:seatId | Seat details | Public |
| 4 | GET | /seats/:seatId/availability | Seat availability for a time window: `?startAt&endAt`, returns booked ranges | Public |
| 5 | POST | /admin/places/:placeId/seats | Create seat | ADMIN |
| 6 | PATCH | /admin/seats/:seatId | Update seat | ADMIN |
| 7 | PATCH | /admin/seats/:seatId/status | Set ACTIVE / MAINTENANCE / UNAVAILABLE | ADMIN |
| 8 | DELETE | /admin/seats/:seatId | Soft-delete seat | ADMIN |

Notes (seats):
- Paging, sorting and filters: see **List endpoints** at the top.
- `/seats/available` and `/seats/:seatId/availability` are routed by the seats controller and answered by the bookings module (`SEAT_AVAILABILITY` port). Availability is derived, never stored (`docs/erd.md` §7):
  - `/seats/available` returns ACTIVE seats with no `PENDING`/`CHECKED_IN`/`CHECKOUT_OVERDUE` booking overlapping `[startAt, endAt)` (when the window includes now, a seat with any `CHECKOUT_OVERDUE` booking is occupied too), as `{ items, page, limit, total, placeOpen }`. If the place is closed during part of the window (opening hours, closures, or the partner closed it), `items` is empty and `placeOpen` is `false`.
  - `/seats/:seatId/availability` returns `{ seatId, placeId, startAt, endAt, available, bookable, placeOpen, occupiedNow, busy: [{ startAt, endAt }] }`. `busy` has no booking or user ids.
  - Both: `400` when `endAt <= startAt` or the window is longer than 31 days; `404` for an unknown, inactive or deleted place or seat. Informational only: `POST /bookings` can still return `409` if someone books first.
- Delete is a soft delete: the seat disappears from reads and its label can be reused. Its `PENDING` bookings are cancelled in the same transaction (users get the cancellation alert; no no-show is counted). `409` while someone is in the seat (`CHECKED_IN` or `CHECKOUT_OVERDUE` booking).
- Status `MAINTENANCE` / `UNAVAILABLE` cancels the seat's `PENDING` bookings the same way; `CHECKED_IN` ones stay.
- Errors: `400` validation or area not in the seat's place; `404` seat/place not found or not visible; `409` label already used in the place.

## 4. Bookings
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | POST | /bookings | Reserve one or more seats: body `{ seatIds[], startAt, endAt }`, same place and time, all-or-nothing (`Idempotency-Key` header supported) | USER |
| 2 | GET | /bookings | My bookings (`view`, `status`, `placeId`, `from`, `to`; sortable) | USER |
| 3 | GET | /bookings/upcoming | My upcoming bookings (same filters, no `view`) | USER |
| 4 | GET | /bookings/history | My booking history (same filters, no `view`) | USER |
| 5 | GET | /bookings/:bookingId | Booking details | USER (own) |
| 6 | PATCH | /bookings/:bookingId | Modify date/time (`?scope=group` for every seat of the booking) | USER (own) |
| 7 | POST | /bookings/:bookingId/cancel | Cancel booking (`?scope=group` supported) | USER (own) |
| 8 | POST | /bookings/:bookingId/extend | Extend booking (`?scope=group` supported) | USER (own) |
| 9 | GET | /admin/bookings | All bookings (`status`, `userId`, `seatId`, `placeId`, `from`, `to`; sortable) | ADMIN |
| 10 | GET | /admin/bookings/:bookingId | Any booking (+ event history) | ADMIN |
| 11 | PATCH | /admin/bookings/:bookingId/status | Cancel or resolve overdue | ADMIN |

Notes (bookings):
- `max_active_per_user` counts the user's active bookings **at that place** (it is a per-place policy).
- `POST /bookings` with an `Idempotency-Key` already used for a *different* request (other seats or times) returns `422`; the same request returns the original booking.
- Modify and extend return `409` when a seat of the booking is no longer bookable (maintenance, deleted, place closed). Modify at a partner-managed place also re-checks the member's eligibility (`403`).
- Start and end must be on `slot_minutes` boundaries of the place's **local** time (a 60-minute slot at an `Asia/Kolkata` place starts at :00 local, :30 UTC). Extend also requires the start to be within `max_advance_days`, like create.
- Admin place and seat changes that make a `PENDING` booking impossible cancel it in the same transaction: seat set to `MAINTENANCE`/`UNAVAILABLE` or deleted, place deactivated or deleted, opening hours or closures changed so the booking falls outside them. Published as `booking.cancelled` with `cancelReason = ADMIN_CANCELLED` (no new contract value); `booking_events.metadata.subReason` says which change (`SEAT_UNAVAILABLE`, `SEAT_DELETED`, `PLACE_DEACTIVATED`, `PLACE_DELETED`, `HOURS_CHANGED`).
- After an extend or modify the checkout reminder is queued again for the new end, even if the old one was already sent.
- API clients can't book yet: the `bookings:read` / `bookings:write` scopes exist, but no booking route accepts an API key (phase 3).

## 5. QR check-in / check-out
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | GET | /bookings/:bookingId/qr-code | Issue one-time QR (revokes previous). `?purpose=CHECK_IN\|CHECK_OUT&mode=GROUP\|EACH`: for a multi-seat booking, GROUP = one QR for all seats, EACH = one QR per seat | USER (own) |
| 2 | POST | /check-in/scan | Scan QR and check in | USER, ADMIN |
| 3 | POST | /check-out/scan | Scan QR and check out | USER, ADMIN |
| 4 | GET | /bookings/:bookingId/check-in-status | Attendance status | USER (own), ADMIN |
| 5 | POST | /admin/bookings/:bookingId/check-in | Manual check-in | ADMIN |
| 6 | POST | /admin/bookings/:bookingId/check-out | Manual check-out | ADMIN |

## 6. Telegram
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | POST | /telegram/link | Generate Telegram deep-link URL | USER |
| 2 | GET | /telegram/status | Connection status | USER |
| 3 | DELETE | /telegram/unlink | Disconnect | USER |
| 4 | POST | /webhooks/telegram | Receive Telegram updates | Telegram |

**Subscribing:** `POST /telegram/link` returns `{ url: https://t.me/<bot>?start=<code>, expiresAt }` (one-time code, `TELEGRAM_LINK_TTL_MINUTES`). One Telegram chat per user and one user per chat. Users can unsubscribe in the app (`DELETE /telegram/unlink`) or from Telegram itself, which is why the webhook exists:

| Update | Effect |
|---|---|
| `/start <code>` | Links the chat to the code's user |
| `/stop`, `/unsubscribe` | Unlinks the chat |
| `/status` | Replies whether the chat is linked |
| `my_chat_member` with status `kicked` / `left` (user blocked the bot) | Unlinks silently |

The webhook checks the `X-Telegram-Bot-Api-Secret-Token` header, records every `update_id` in `inbox_events` (processed once) and always answers 200.

## 7. Admin monitoring

> **Planned, not built.** For now use `GET /admin/users/stats` (1, 8i) and `GET /admin/bookings?status=...` (4, 9).

| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | GET | /admin/dashboard | Dashboard statistics | ADMIN |
| 2 | GET | /admin/occupancy | Live seat occupancy | ADMIN |
| 3 | GET | /admin/seats | All seats and statuses | ADMIN |
| 4 | GET | /admin/bookings/active | Active bookings | ADMIN |
| 5 | GET | /admin/bookings/overdue | Overdue checkouts | ADMIN |
| 6 | GET | /admin/bookings/no-shows | Expired / no-show bookings | ADMIN |

## 8. Integration management and partner endpoints
API keys: `sbk_<live|test>_<prefix>_<secret>` in header `X-API-Key`, sha256-hashed at rest, scopes `places:read`, `identities:link`, `bookings:read`, `bookings:write` (`docs/integration/service-authentication.md` §2.1). Only rows 6, 8 and 9 below check the key today; places and seats (sections 2 and 3) are public, so partners call them without one.

| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | POST | /admin/api-clients | Create client, returns the key once (`201`, `409` duplicate name) | ADMIN |
| 2 | GET | /admin/api-clients | List clients (paginated, sortable) | ADMIN |
| 3 | GET | /admin/api-clients/:clientId | Get one client (never the key or hash) | ADMIN |
| 4 | PATCH | /admin/api-clients/:clientId | Rename, change scopes, deactivate (`isActive: false`) | ADMIN |
| 5 | POST | /admin/api-clients/:clientId/rotate-key | New key, returned once; the old key stops working immediately | ADMIN |
| 6 | GET | /integrations/library/places/:placeId | LMS: sync status of an LMS place (applied revision, `bookingOpen`, seat id mapping). `:placeId` is the LMS id | API key, `places:read` |
| 7 | POST | /admin/integrations/library/places/:placeId/resync | Fetch the place from LMS (`GET {LMS_BASE_URL}/external/places/:id/snapshot`) and apply it. `404` LMS has no such place, `503` LMS not configured | ADMIN |
| 8 | POST | /integrations/library/link-requests | LMS starts linking member `{ memberId }`: returns `{ code, linkUrl, expiresAt }` (single use, 10 min) | API key, `identities:link` |
| 9 | DELETE | /integrations/library/links/:memberId | LMS unlinks a member (`204`, `404` not linked) | API key, `identities:link` |
| 10 | POST | /integrations/library/my-link | User confirms a link code `{ code }` (`201`, `400` invalid/used/expired, `409` already linked) | USER |
| 11 | GET | /integrations/library/my-link | The user's linked LMS member (`404` if none) | USER |
| 12 | DELETE | /integrations/library/my-link | User unlinks (`204`) | USER |

New bookings at an LMS place return `403` when the user's linked LMS member is not eligible (`member.standing_changed`).

## 9. Async events (RabbitMQ, not HTTP)

Published to topic exchange `space-booking.events` from `outbox_events` by the outbox relay (live when `RABBITMQ_URL` is set). Payloads never contain secrets. Message envelope, naming, versioning and delivery rules: `docs/integration/messaging-contract.md` (proposed). `booking.*` v1 schemas and examples: `docs/integration/schemas/`, `docs/integration/fixtures/`; LMS hand-off: `docs/integration/lms-booking-events-now.md`.

| Routing key | When |
|---|---|
| `booking.created` | Booking reserved |
| `booking.modified` / `booking.extended` | Time range changed |
| `booking.cancelled` | Cancelled by user, admin or client |
| `booking.checked_in` / `booking.checked_out` | Attendance |
| `booking.expired` | Expire job |
| `booking.checkout_overdue` | Overdue job |
| `seat.status_changed` | Admin changed seat status (**not emitted yet**) |
| `place.sync_applied` / `place.sync_rejected` | Reply to an LMS place snapshot; `sync_applied` also when an admin flips `isActive` on an LMS place |

| `booking.alert_due` | A late check-in, checkout reminder or forgotten-checkout alert became due |
| `identity.linked` / `identity.unlinked` | A user and an LMS member were linked / unlinked |

Every row is validated against the contract when it is written (`OutboxService`); write endpoints carry `@Publishes(...)` (Swagger `x-publishes`). Which endpoint publishes what: `docs/integration/lms-message-contract.md` §1.3.

Consumed from `library.events` (LMS), when `LIBRARY_INTEGRATION_ENABLED=true`: `place.created`, `place.updated`, `member.standing_changed`. Full catalogue, both directions: `docs/integration/lms-message-contract.md`.

## 10. Scheduled jobs (internal)

| Job | What it does |
|---|---|
| Expire bookings (every minute) | PENDING not checked in by start + `checkin_grace_minutes` (15) → EXPIRED, `no_show_count + 1` (once per multi-seat booking), QR revoked, `BOOKING_EXPIRED` alert; seat released |
| Detect overdue checkouts (every minute) | CHECKED_IN not checked out by end + `overdue_alert_minutes` (booking 10:00-11:00 → 11:15) → CHECKOUT_OVERDUE + `FORGOTTEN_CHECKOUT` alert |
| Notification sender | Sends due `notifications` (Telegram / email), retries failures (every 30 s). Booking alert timeline: `BOOKING_CONFIRMED` on create, `LATE_CHECKIN` at start + `late_checkin_alert_minutes` (5, skipped once checked in), expiry at start + 15, `CHECKOUT_REMINDER` at end − 15, `FORGOTTEN_CHECKOUT` at end + 15. Sent right away on every change: `BOOKING_MODIFIED` (old and new time; old QR codes are revoked), `BOOKING_EXTENDED`, `BOOKING_CANCELLED` (user or admin), `CHECKED_IN` / `CHECKED_OUT` (QR or admin manual). One message per multi-seat booking |
| Outbox relay | Publishes unpublished `outbox_events` to RabbitMQ |

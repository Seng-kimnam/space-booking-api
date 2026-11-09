# API Endpoints

Based on the team draft v1.0 (4 Nov 2026), with `/libraries` renamed to `/places` (the app is generic; a library is one place type). All paths are relative to `/api/v1`.

**Access:** Public = no login. USER / ADMIN = JWT with that role. Client = `api_clients` key with the listed scope (sync integration). Telegram = Telegram calling with the webhook secret header.

## 1. Authentication
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | POST | /auth/register | Register account | Public |
| 2 | POST | /auth/verify-email | Verify email with OTP | Public |
| 3 | POST | /auth/resend-otp | Resend verification OTP | Public |
| 4 | POST | /auth/login | Login | Public |
| 5 | POST | /auth/refresh-token | Refresh access token | Public |
| 6 | POST | /auth/forgot-password | Send password reset OTP | Public |
| 7 | POST | /auth/reset-password | Reset password | Public |
| 8 | POST | /auth/logout | Logout (revoke refresh token) | USER, ADMIN |
| 9 | GET | /auth/me | Current user profile | USER, ADMIN |
| 10 | PATCH | /auth/change-password | Change password | USER, ADMIN |
| 11 | GET | /auth/oauth/:provider | Start sign-in: 302 redirect to Google / Facebook consent screen | Public |
| 12 | GET | /auth/oauth/:provider/callback | OAuth callback (provider redirects here); 302 back to the client app | Provider |
| 13 | POST | /auth/oauth/exchange | Swap the one-time login code from the callback for our tokens | Public |
| 14 | POST | /auth/oauth/complete-signup | Finish sign-up when the provider shared no email | Public |
| 15 | POST | /auth/oauth/:provider/token | Sign in with a provider token (mobile / native SDK flow) | Public |
| 16 | GET | /auth/identities | List linked Google / Facebook accounts | USER, ADMIN |
| 17 | POST | /auth/identities/:provider/link | Start linking: returns the provider authorization URL | USER, ADMIN |
| 18 | DELETE | /auth/identities/:provider | Unlink (rejected if it is the last sign-in method) | USER, ADMIN |

`:provider` is `google` or `facebook`.

### Social sign-in flows

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
- Proposed env vars (add to `.env.example` and config validation when implementing): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_CALLBACK_URL`, `OAUTH_ALLOWED_REDIRECT_URIS` (comma-separated). The callback URLs must also be registered in the Google Cloud and Meta developer consoles.

## 2. Places and areas
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | GET | /places | List / search places | Public, Client `places:read` |
| 2 | GET | /places/:placeId | Place details (incl. opening hours) | Public, Client `places:read` |
| 3 | GET | /places/:placeId/areas | Areas of a place | Public, Client `places:read` |
| 4 | GET | /places/:placeId/seats | Seats in a place | Public, Client `places:read` |
| 5 | POST | /admin/places | Create place (+ default policy) | ADMIN |
| 6 | PATCH | /admin/places/:placeId | Update place, opening hours, closures, policy | ADMIN |
| 7 | DELETE | /admin/places/:placeId | Soft-delete place | ADMIN |
| 8 | POST | /admin/places/:placeId/areas | Create area | ADMIN |
| 9 | PATCH | /admin/areas/:areaId | Update area | ADMIN |
| 10 | DELETE | /admin/areas/:areaId | Soft-delete area | ADMIN |

## 3. Seats
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | GET | /seats | List seats (filter by place, area, status) | Public, Client `places:read` |
| 2 | GET | /seats/available | Available seats for a time window | Public, Client `places:read` |
| 3 | GET | /seats/:seatId | Seat details | Public, Client `places:read` |
| 4 | GET | /seats/:seatId/availability | Seat availability for a date/time | Public, Client `places:read` |
| 5 | POST | /admin/places/:placeId/seats | Create seat | ADMIN |
| 6 | PATCH | /admin/seats/:seatId | Update seat | ADMIN |
| 7 | PATCH | /admin/seats/:seatId/status | Set ACTIVE / MAINTENANCE / UNAVAILABLE | ADMIN |
| 8 | DELETE | /admin/seats/:seatId | Soft-delete seat | ADMIN |

Notes (seats):
- List endpoints take `page` (>=1, default 1) and `limit` (1..100, default 20) and return `{ items, page, limit, total }`. Unknown query params are rejected with 400.
- `/seats/available` and `/seats/:seatId/availability` are implemented by the bookings module, not seats.
- Delete is a soft delete: the seat disappears from reads and its label can be reused.
- Errors: `400` validation or area not in the seat's place; `404` seat/place not found or not visible; `409` label already used in the place.

## 4. Bookings
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | POST | /bookings | Reserve one or more seats: body `{ seatIds[], startAt, endAt }`, same place and time, all-or-nothing (`Idempotency-Key` header supported) | USER, Client `bookings:write` |
| 2 | GET | /bookings | My bookings | USER |
| 3 | GET | /bookings/upcoming | My upcoming bookings | USER |
| 4 | GET | /bookings/history | My booking history | USER |
| 5 | GET | /bookings/:bookingId | Booking details | USER (own), Client `bookings:read` |
| 6 | PATCH | /bookings/:bookingId | Modify date/time (`?scope=group` for every seat of the booking) | USER (own) |
| 7 | POST | /bookings/:bookingId/cancel | Cancel booking (`?scope=group` supported) | USER (own), Client `bookings:write` |
| 8 | POST | /bookings/:bookingId/extend | Extend booking (`?scope=group` supported) | USER (own) |
| 9 | GET | /admin/bookings | All bookings | ADMIN |
| 10 | GET | /admin/bookings/:bookingId | Any booking (+ event history) | ADMIN |
| 11 | PATCH | /admin/bookings/:bookingId/status | Cancel or resolve overdue | ADMIN |

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
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | GET | /admin/dashboard | Dashboard statistics | ADMIN |
| 2 | GET | /admin/occupancy | Live seat occupancy | ADMIN |
| 3 | GET | /admin/seats | All seats and statuses | ADMIN |
| 4 | GET | /admin/bookings/active | Active bookings | ADMIN |
| 5 | GET | /admin/bookings/overdue | Overdue checkouts | ADMIN |
| 6 | GET | /admin/bookings/no-shows | Expired / no-show bookings | ADMIN |

## 8. Integration management (proposed, new)
| # | Method | Endpoint | Description | Access |
|---|---|---|---|---|
| 1 | POST | /admin/api-clients | Create client, returns raw key once | ADMIN |
| 2 | GET | /admin/api-clients | List clients | ADMIN |
| 3 | PATCH | /admin/api-clients/:clientId | Update scopes / deactivate | ADMIN |
| 4 | POST | /admin/api-clients/:clientId/rotate-key | Rotate key | ADMIN |

## 9. Async events (RabbitMQ, not HTTP)

Published to topic exchange `space-booking.events` from `outbox_events`. Payloads never contain secrets.

| Routing key | When |
|---|---|
| `booking.created` | Booking reserved |
| `booking.modified` / `booking.extended` | Time range changed |
| `booking.cancelled` | Cancelled by user, admin or client |
| `booking.checked_in` / `booking.checked_out` | Attendance |
| `booking.expired` | Expire job |
| `booking.checkout_overdue` | Overdue job |
| `seat.status_changed` | Admin changed seat status |

## 10. Scheduled jobs (internal)

| Job | What it does |
|---|---|
| Expire bookings (every minute) | PENDING not checked in by start + `checkin_grace_minutes` (15) → EXPIRED, `no_show_count + 1` (once per multi-seat booking), QR revoked, `BOOKING_EXPIRED` alert; seat released |
| Detect overdue checkouts (every minute) | CHECKED_IN not checked out by end + `overdue_alert_minutes` (booking 10:00-11:00 → 11:15) → CHECKOUT_OVERDUE + `FORGOTTEN_CHECKOUT` alert |
| Notification sender | Sends due `notifications` (Telegram / email), retries failures (every 30 s). Booking alert timeline: `BOOKING_CONFIRMED` on create, `LATE_CHECKIN` at start + `late_checkin_alert_minutes` (5, skipped once checked in), expiry at start + 15, `CHECKOUT_REMINDER` at end − 15, `FORGOTTEN_CHECKOUT` at end + 15. Sent right away on every change: `BOOKING_MODIFIED` (old and new time; old QR codes are revoked), `BOOKING_EXTENDED`, `BOOKING_CANCELLED` (user or admin), `CHECKED_IN` / `CHECKED_OUT` (QR or admin manual). One message per multi-seat booking |
| Outbox relay | Publishes unpublished `outbox_events` to RabbitMQ |

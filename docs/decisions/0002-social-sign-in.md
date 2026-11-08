# ADR 0002: Social sign-in with Google and Facebook

- **Status:** Proposed (needs team review)
- **Date:** 2026-11-08

## Context

Users should be able to sign in with Google or Facebook in addition to email + password. The schema assumed every user has a password and had nowhere to store a third-party account id.

## Decisions

1. **New table `auth_identities`** (`user_id`, `provider`, `provider_user_id`, `provider_email`, `email_verified`, profile snapshot, `linked_at`, `last_login_at`). UNIQUE `(provider, provider_user_id)` and `(user_id, provider)`.
2. **`users.password_hash` becomes nullable.** The service enforces that each user keeps at least one sign-in method.
3. **Redirect flow with a backend callback, plus a token flow for mobile.**
   - Web: `GET /auth/oauth/:provider` redirects to the provider (Authorization Code + PKCE, random `state`), and the provider calls back `GET /auth/oauth/:provider/callback`. The backend exchanges the code with the client secret, verifies the identity, then redirects to an allowlisted client `redirect_uri` with a **one-time login code**. The client swaps it for our JWT + refresh token at `POST /auth/oauth/exchange`. Tokens are never put in a URL.
   - Mobile / native SDKs: `POST /auth/oauth/:provider/token` with the provider token.
   - State, login codes and signup tickets live in Redis with short TTLs, single use. No new table.
4. **Match on provider id, never on email.** Auto-link by email only when the provider says it is verified (Google `email_verified`; Facebook emails are treated as unverified). Otherwise the user signs in and links explicitly. This prevents account takeover through an unverified email.
5. **No provider tokens stored.** If we later call Google/Facebook APIs on the user's behalf, store those tokens encrypted (not hashed) in a new migration.
6. **`users.email` stays NOT NULL.** If Facebook does not share an email, sign-up collects one and verifies it with an OTP.

## Consequences

- New dependencies when implementing: `@nestjs/passport` with `passport-google-oauth20` and `passport-facebook` for the redirect flow (or `openid-client`), `google-auth-library` for ID-token verification in the token flow. Facebook token checks use plain HTTP to the Graph API.
- New env vars (to add to `.env.example` and config validation): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_CALLBACK_URL`, `OAUTH_ALLOWED_REDIRECT_URIS`. Callback URLs must be registered in the Google and Meta consoles.
- 18 tables total.

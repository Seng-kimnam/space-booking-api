import { applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard, ThrottlerOptions } from '@nestjs/throttler';

// Rate limits for the public /auth routes (docs/auth.md, finding H2).
// Two counters run on every throttled route:
// - `ip`: per client IP, against one machine hammering many accounts.
// - `account`: per email in the body, against many machines (credential
//   stuffing) hammering one account. Routes without an email fall back to the IP.
// Storage is in-memory (one instance). Keys are sha256-hashed by the throttler,
// so emails are never held in plain text. Exceeding a limit returns 429.

export const IP_THROTTLER = 'ip';
export const ACCOUNT_THROTTLER = 'account';

const MINUTE = 60_000;

/**
 * Per-account key: the body's email, trimmed and lowercased to match
 * `users.email` (citext), so "A@x.com" and "a@x.com" share one counter.
 * `any`: matches the throttler's ThrottlerGetTrackerFunction signature.
 */
export function accountTracker(req: Record<string, any>): string {
  const email: unknown = req.body?.email;
  return typeof email === 'string' && email.trim()
    ? `email:${email.trim().toLowerCase()}`
    : `ip:${String(req.ip)}`;
}

/** Defaults; every throttled route overrides them with one of the sets below. */
export const AUTH_THROTTLERS: ThrottlerOptions[] = [
  { name: IP_THROTTLER, ttl: MINUTE, limit: 20 },
  {
    name: ACCOUNT_THROTTLER,
    ttl: 15 * MINUTE,
    limit: 10,
    getTracker: accountTracker,
  },
];

type Limits = Record<
  typeof IP_THROTTLER | typeof ACCOUNT_THROTTLER,
  { ttl: number; limit: number }
>;

/** Password login. 10 per 15 min per account is far above normal use. */
export const LOGIN_LIMITS: Limits = {
  [IP_THROTTLER]: { ttl: MINUTE, limit: 10 },
  [ACCOUNT_THROTTLER]: { ttl: 15 * MINUTE, limit: 10 },
};

/** Routes that send an email (register, resend-otp, forgot-password). */
export const OTP_SEND_LIMITS: Limits = {
  [IP_THROTTLER]: { ttl: MINUTE, limit: 5 },
  [ACCOUNT_THROTTLER]: { ttl: 15 * MINUTE, limit: 3 },
};

/**
 * Routes that check an OTP (verify-email, reset-password). The per-code cap
 * of 5 attempts (AuthService) still applies on top of these.
 */
export const OTP_CHECK_LIMITS: Limits = {
  [IP_THROTTLER]: { ttl: MINUTE, limit: 10 },
  [ACCOUNT_THROTTLER]: { ttl: 15 * MINUTE, limit: 10 },
};

/** Refresh has no email, so both counters key on the IP. */
export const REFRESH_LIMITS: Limits = {
  [IP_THROTTLER]: { ttl: MINUTE, limit: 30 },
  [ACCOUNT_THROTTLER]: { ttl: 15 * MINUTE, limit: 300 },
};

/** ThrottlerGuard plus this route's limits. Use on public /auth routes only. */
export const AuthThrottle = (limits: Limits) =>
  applyDecorators(UseGuards(ThrottlerGuard), Throttle(limits));

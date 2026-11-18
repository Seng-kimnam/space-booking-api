import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API keys for integrating systems (docs/integration/service-authentication.md
 * section 2.1). Format: sbk_<env>_<prefix>_<secret>
 *   env     live | test, so a leaked staging key is easy to spot
 *   prefix  8 chars, stored in api_clients.key_prefix to find the client
 *   secret  32 random bytes, base64url (43 chars); only sha256(secret) is stored
 * SHA-256 (not bcrypt) is enough for 256 bits of randomness and keeps every
 * request cheap.
 */
export const API_KEY_HEADER = 'x-api-key';

export const API_CLIENT_SCOPES = [
  'places:read',
  'identities:link',
  'bookings:read',
  'bookings:write',
] as const;
export type ApiClientScope = (typeof API_CLIENT_SCOPES)[number];

const KEY_PATTERN = /^sbk_(live|test)_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  /** Shown to the admin once, never stored. */
  key: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(env: 'live' | 'test'): GeneratedApiKey {
  const prefix = randomBytes(6).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  return { key: `sbk_${env}_${prefix}_${secret}`, prefix, hash: hashSecret(secret) };
}

/** Null when the header isn't a well-formed key (answered with the same 401). */
export function parseApiKey(raw: unknown): { env: string; prefix: string; secret: string } | null {
  if (typeof raw !== 'string') return null;
  const m = KEY_PATTERN.exec(raw.trim());
  return m ? { env: m[1], prefix: m[2], secret: m[3] } : null;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function digestsEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

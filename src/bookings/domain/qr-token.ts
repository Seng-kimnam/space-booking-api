import { createHash, randomBytes } from 'crypto';

/**
 * QR payload format: `sb1.<scope>.<id>.<secret>`
 *   scope `b` + booking id  -> checks in/out that one booking
 *   scope `g` + group id    -> checks in/out every seat of a multi-seat booking
 *
 * Only hashes are stored (booking_qr_tokens.token_hash), one row per booking:
 * sha256(secret + ':' + bookingId). Mixing in the booking id lets one group
 * secret produce a distinct hash per seat, which keeps token_hash UNIQUE and
 * the "one live QR per booking and purpose" index meaningful.
 */
const VERSION = 'sb1';
const SECRET_BYTES = 32;
const PAYLOAD_PATTERN =
  /^sb1\.(g|b)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export type QrScope = 'GROUP' | 'BOOKING';

export interface ParsedQr {
  scope: QrScope;
  id: string;
  secret: string;
}

export function newQrSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

export function buildQrPayload(scope: QrScope, id: string, secret: string): string {
  return `${VERSION}.${scope === 'GROUP' ? 'g' : 'b'}.${id}.${secret}`;
}

/** Null for anything that isn't a well-formed payload of ours. */
export function parseQrPayload(text: string): ParsedQr | null {
  const match = PAYLOAD_PATTERN.exec(text.trim());
  if (!match) return null;
  return {
    scope: match[1] === 'g' ? 'GROUP' : 'BOOKING',
    id: match[2],
    secret: match[3],
  };
}

export function hashQrSecret(secret: string, bookingId: string): string {
  return createHash('sha256').update(`${secret}:${bookingId}`).digest('hex');
}

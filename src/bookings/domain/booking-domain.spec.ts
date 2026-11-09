import { ConflictException } from '@nestjs/common';
import { BookingStatus } from '../../common/enums';
import { assertTransition, canTransition } from './booking-state';
import { buildQrPayload, hashQrSecret, newQrSecret, parseQrPayload } from './qr-token';
import { formatInZone } from './time';

describe('booking-state', () => {
  it.each([
    [BookingStatus.PENDING, BookingStatus.CHECKED_IN],
    [BookingStatus.PENDING, BookingStatus.CANCELLED],
    [BookingStatus.PENDING, BookingStatus.EXPIRED],
    [BookingStatus.CHECKED_IN, BookingStatus.COMPLETED],
    [BookingStatus.CHECKED_IN, BookingStatus.CHECKOUT_OVERDUE],
    [BookingStatus.CHECKOUT_OVERDUE, BookingStatus.COMPLETED],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [BookingStatus.CHECKED_IN, BookingStatus.CANCELLED],
    [BookingStatus.EXPIRED, BookingStatus.CHECKED_IN],
    [BookingStatus.CANCELLED, BookingStatus.PENDING],
    [BookingStatus.COMPLETED, BookingStatus.CHECKED_IN],
    [BookingStatus.PENDING, BookingStatus.COMPLETED],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(ConflictException);
  });
});

describe('qr-token', () => {
  const bookingId = '33333333-3333-4333-8333-3333333300a1';

  it('round-trips a seat payload', () => {
    const secret = newQrSecret();
    expect(parseQrPayload(buildQrPayload('BOOKING', bookingId, secret))).toEqual({
      scope: 'BOOKING',
      id: bookingId,
      secret,
    });
  });

  it('round-trips a group payload', () => {
    const secret = newQrSecret();
    expect(parseQrPayload(buildQrPayload('GROUP', bookingId, secret))?.scope).toBe('GROUP');
  });

  it.each(['', 'hello', `sb1.x.${bookingId}.abc`, `sb2.b.${bookingId}.${'a'.repeat(43)}`, `sb1.b.not-a-uuid.${'a'.repeat(43)}`])(
    'rejects malformed payload %p',
    (text) => {
      expect(parseQrPayload(text)).toBeNull();
    },
  );

  it('gives each seat a different hash for the same group secret', () => {
    const secret = newQrSecret();
    expect(hashQrSecret(secret, 'a')).not.toBe(hashQrSecret(secret, 'b'));
    expect(hashQrSecret(secret, 'a')).toBe(hashQrSecret(secret, 'a'));
  });

  it('never repeats a secret', () => {
    expect(newQrSecret()).not.toBe(newQrSecret());
  });
});

describe('formatInZone', () => {
  it("shows the place's wall-clock time", () => {
    expect(formatInZone(new Date('2026-11-09T03:00:00.000Z'), 'Asia/Phnom_Penh')).toBe('2026-11-09 10:00');
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { BookingStatus } from '../../common/enums';
import type { BookingPolicy } from '../../places/entities/booking-policy.entity';
import { Booking } from '../entities/booking.entity';
import { BookingRulesService } from './booking-rules.service';

const policy = {
  placeId: 'p',
  checkinGraceMinutes: 15,
  lateCheckinAlertMinutes: 5,
  checkoutReminderMinutes: 15,
  overdueAlertMinutes: 15,
  minMinutes: 30,
  maxMinutes: 240,
  slotMinutes: 15,
  maxAdvanceDays: 7,
  maxActivePerUser: 5,
  maxExtensions: 2,
  modifyCutoffMinutes: 30,
} as BookingPolicy;

const at = (iso: string) => new Date(iso);
const now = at('2026-11-09T02:00:00.000Z');

function booking(overrides: Partial<Booking> = {}): Booking {
  return Object.assign(new Booking(), {
    id: 'b1',
    status: BookingStatus.PENDING,
    extensionCount: 0,
    timeRange: { start: at('2026-11-09T03:00:00.000Z'), end: at('2026-11-09T04:00:00.000Z') },
    ...overrides,
  });
}

describe('BookingRulesService', () => {
  const rules = new BookingRulesService();

  describe('validateNewRange', () => {
    const ok = { start: at('2026-11-09T03:00:00.000Z'), end: at('2026-11-09T04:00:00.000Z') };

    it('accepts a valid range', () => {
      expect(() => rules.validateNewRange(ok, policy, now)).not.toThrow();
    });

    it.each([
      ['end before start', { start: ok.end, end: ok.start }],
      ['in the past', { start: at('2026-11-09T01:00:00.000Z'), end: at('2026-11-09T02:00:00.000Z') }],
      ['not on a slot boundary', { start: at('2026-11-09T03:05:00.000Z'), end: at('2026-11-09T04:05:00.000Z') }],
      ['shorter than min_minutes', { start: ok.start, end: at('2026-11-09T03:15:00.000Z') }],
      ['longer than max_minutes', { start: ok.start, end: at('2026-11-09T07:15:00.000Z') }],
      ['beyond max_advance_days', { start: at('2026-11-17T03:00:00.000Z'), end: at('2026-11-17T04:00:00.000Z') }],
    ])('rejects a range %s', (_label, range) => {
      expect(() => rules.validateNewRange(range, policy, now)).toThrow(BadRequestException);
    });
  });

  describe('validateModify / validateUserCancel', () => {
    it('allows changes before start - modify_cutoff_minutes', () => {
      expect(() => rules.validateModify(booking(), policy, at('2026-11-09T02:30:00.000Z'))).not.toThrow();
      expect(() => rules.validateUserCancel(booking(), policy, at('2026-11-09T02:30:00.000Z'))).not.toThrow();
    });

    it('rejects changes after the cutoff', () => {
      expect(() => rules.validateModify(booking(), policy, at('2026-11-09T02:31:00.000Z'))).toThrow(ConflictException);
      expect(() => rules.validateUserCancel(booking(), policy, at('2026-11-09T02:31:00.000Z'))).toThrow(ConflictException);
    });

    it('rejects bookings that are not PENDING', () => {
      const checkedIn = booking({ status: BookingStatus.CHECKED_IN });
      expect(() => rules.validateModify(checkedIn, policy, now)).toThrow(ConflictException);
      expect(() => rules.validateUserCancel(checkedIn, policy, now)).toThrow(ConflictException);
    });
  });

  describe('validateExtend', () => {
    it('returns the extended range for a checked-in booking', () => {
      const b = booking({ status: BookingStatus.CHECKED_IN });
      expect(rules.validateExtend(b, at('2026-11-09T04:30:00.000Z'), policy, at('2026-11-09T03:30:00.000Z'))).toEqual({
        start: b.timeRange.start,
        end: at('2026-11-09T04:30:00.000Z'),
      });
    });

    it('rejects when max_extensions is used up', () => {
      const b = booking({ extensionCount: 2 });
      expect(() => rules.validateExtend(b, at('2026-11-09T04:30:00.000Z'), policy, now)).toThrow(ConflictException);
    });

    it('rejects a new end that is not later', () => {
      expect(() => rules.validateExtend(booking(), at('2026-11-09T04:00:00.000Z'), policy, now)).toThrow(BadRequestException);
    });

    it('rejects going over max_minutes', () => {
      expect(() => rules.validateExtend(booking(), at('2026-11-09T07:15:00.000Z'), policy, now)).toThrow(BadRequestException);
    });

    it('rejects a finished booking', () => {
      const b = booking({ status: BookingStatus.COMPLETED });
      expect(() => rules.validateExtend(b, at('2026-11-09T04:30:00.000Z'), policy, now)).toThrow(ConflictException);
    });
  });

  describe('slot alignment in the place timezone', () => {
    const hourly = { ...policy, slotMinutes: 60 } as BookingPolicy;

    it('accepts 10:00-11:00 local in a half-hour zone (Asia/Kolkata, +05:30)', () => {
      // 10:00 IST = 04:30Z: not on a UTC hour, but on a local one.
      const range = { start: at('2026-11-09T04:30:00.000Z'), end: at('2026-11-09T05:30:00.000Z') };
      expect(() => rules.validateNewRange(range, hourly, now, 'Asia/Kolkata')).not.toThrow();
      expect(() => rules.validateNewRange(range, hourly, now, 'UTC')).toThrow(BadRequestException);
    });

    it('rejects a UTC hour that is a half hour locally', () => {
      const range = { start: at('2026-11-09T04:00:00.000Z'), end: at('2026-11-09T05:00:00.000Z') };
      expect(() => rules.validateNewRange(range, hourly, now, 'Asia/Kolkata')).toThrow(BadRequestException);
    });

    it('keeps whole-hour zones unchanged (Asia/Phnom_Penh)', () => {
      const range = { start: at('2026-11-09T03:00:00.000Z'), end: at('2026-11-09T04:00:00.000Z') };
      expect(() => rules.validateNewRange(range, hourly, now, 'Asia/Phnom_Penh')).not.toThrow();
    });

    it('applies to extend too', () => {
      const b = booking({
        timeRange: { start: at('2026-11-09T04:30:00.000Z'), end: at('2026-11-09T05:30:00.000Z') },
      });
      expect(
        rules.validateExtend(b, at('2026-11-09T06:30:00.000Z'), hourly, now, 'Asia/Kolkata').end,
      ).toEqual(at('2026-11-09T06:30:00.000Z'));
    });
  });

  describe('validateExtend and max_advance_days', () => {
    it('rejects extending a booking whose start is beyond the (shortened) advance window', () => {
      // Booked 7 days ahead, then the policy went down to 1 day.
      const b = booking({
        timeRange: { start: at('2026-11-15T03:00:00.000Z'), end: at('2026-11-15T04:00:00.000Z') },
      });
      const shorter = { ...policy, maxAdvanceDays: 1 } as BookingPolicy;
      expect(() => rules.validateExtend(b, at('2026-11-15T04:30:00.000Z'), shorter, now)).toThrow(
        BadRequestException,
      );
      expect(() => rules.validateExtend(b, at('2026-11-15T04:30:00.000Z'), policy, now)).not.toThrow();
    });
  });

  it('checkInWindow opens early and closes at start + grace', () => {
    expect(rules.checkInWindow(booking().timeRange, policy, 15)).toEqual({
      opensAt: at('2026-11-09T02:45:00.000Z'),
      closesAt: at('2026-11-09T03:15:00.000Z'),
    });
  });
});

import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { BookingStatus } from '../../common/enums';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import type { BookingPolicy } from '../../places/entities/booking-policy.entity';
import { Booking } from '../entities/booking.entity';
import {
  addMinutes,
  MINUTE_MS,
  minutesBetween,
  zoneOffsetMinutes,
} from '../domain/time';

export interface TimeWindow {
  opensAt: Date;
  closesAt: Date;
}

/**
 * Policy checks from booking_policies (never hardcoded). Pure: no I/O, `now` is
 * passed in, so every rule is unit-testable. Opening hours / closures are
 * checked by the caller through PlaceRulesPort.
 */
@Injectable()
export class BookingRulesService {
  /** Rules for a new range (create, modify). `timezone`: the place's IANA zone, for slot alignment. */
  validateNewRange(
    range: TimeRange,
    policy: BookingPolicy,
    now: Date,
    timezone = 'UTC',
  ): void {
    const { start, end } = range;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startAt and endAt must be valid dates');
    }
    if (end <= start) {
      throw new BadRequestException('endAt must be after startAt');
    }
    if (start < now) {
      throw new BadRequestException("Bookings can't start in the past");
    }
    this.assertAligned(range, policy, timezone);
    this.assertDuration(range, policy);
    this.assertWithinAdvance(start, policy, now);
  }

  /** Modify: only PENDING, and not later than start - modify_cutoff_minutes. */
  validateModify(booking: Booking, policy: BookingPolicy, now: Date): void {
    if (booking.status !== BookingStatus.PENDING) {
      throw new ConflictException('Only bookings that have not started can be modified');
    }
    this.assertBeforeCutoff(booking, policy, now, 'modified');
  }

  /** Cancel by the user: only PENDING, and not later than start - modify_cutoff_minutes. */
  validateUserCancel(booking: Booking, policy: BookingPolicy, now: Date): void {
    if (booking.status !== BookingStatus.PENDING) {
      throw new ConflictException('Only bookings that have not started can be cancelled');
    }
    this.assertBeforeCutoff(booking, policy, now, 'cancelled');
  }

  /**
   * Extend: PENDING or CHECKED_IN, later end, within max_extensions and
   * max_minutes, and (like create) starting within max_advance_days of now,
   * which only bites after the policy's window was shortened.
   */
  validateExtend(
    booking: Booking,
    newEnd: Date,
    policy: BookingPolicy,
    now: Date,
    timezone = 'UTC',
  ): TimeRange {
    if (
      booking.status !== BookingStatus.PENDING &&
      booking.status !== BookingStatus.CHECKED_IN
    ) {
      throw new ConflictException('Only upcoming or checked-in bookings can be extended');
    }
    if (Number.isNaN(newEnd.getTime()) || newEnd <= booking.timeRange.end) {
      throw new BadRequestException('endAt must be after the current end');
    }
    if (booking.timeRange.end <= now) {
      throw new ConflictException('This booking has already ended');
    }
    if (booking.extensionCount >= policy.maxExtensions) {
      throw new ConflictException(
        `A booking can be extended at most ${policy.maxExtensions} times`,
      );
    }
    const range = { start: booking.timeRange.start, end: newEnd };
    this.assertAligned(range, policy, timezone);
    this.assertDuration(range, policy);
    this.assertWithinAdvance(range.start, policy, now);
    return range;
  }

  /** QR check-in is accepted from start - earlyMinutes until start + checkin_grace_minutes. */
  checkInWindow(range: TimeRange, policy: BookingPolicy, earlyMinutes: number): TimeWindow {
    return {
      opensAt: addMinutes(range.start, -earlyMinutes),
      closesAt: addMinutes(range.start, policy.checkinGraceMinutes),
    };
  }

  private assertBeforeCutoff(
    booking: Booking,
    policy: BookingPolicy,
    now: Date,
    action: string,
  ): void {
    const cutoff = addMinutes(booking.timeRange.start, -policy.modifyCutoffMinutes);
    if (now > cutoff) {
      throw new ConflictException(
        `Bookings can't be ${action} less than ${policy.modifyCutoffMinutes} minutes before they start`,
      );
    }
  }

  private assertWithinAdvance(start: Date, policy: BookingPolicy, now: Date): void {
    if (start > addMinutes(now, policy.maxAdvanceDays * 24 * 60)) {
      throw new BadRequestException(
        `Bookings can be made at most ${policy.maxAdvanceDays} days ahead`,
      );
    }
  }

  // Aligned on the place's local wall clock, so half-hour zones (Asia/Kolkata)
  // with 60-minute slots accept 10:00-11:00 local. Each bound uses its own
  // offset, so a range across a DST change stays aligned on both sides.
  private aligned(at: Date, slotMs: number, timezone: string): boolean {
    const local = at.getTime() + zoneOffsetMinutes(at, timezone) * MINUTE_MS;
    return ((local % slotMs) + slotMs) % slotMs === 0;
  }

  private assertAligned(
    range: TimeRange,
    policy: BookingPolicy,
    timezone: string,
  ): void {
    const slotMs = policy.slotMinutes * MINUTE_MS;
    if (
      !this.aligned(range.start, slotMs, timezone) ||
      !this.aligned(range.end, slotMs, timezone)
    ) {
      throw new BadRequestException(
        `Start and end must be on ${policy.slotMinutes}-minute boundaries`,
      );
    }
  }

  private assertDuration(range: TimeRange, policy: BookingPolicy): void {
    const minutes = minutesBetween(range.start, range.end);
    if (minutes < policy.minMinutes || minutes > policy.maxMinutes) {
      throw new BadRequestException(
        `A booking must last between ${policy.minMinutes} and ${policy.maxMinutes} minutes`,
      );
    }
  }
}

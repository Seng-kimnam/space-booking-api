import { ConflictException } from '@nestjs/common';
import { BookingStatus } from '../../common/enums';

/** Allowed status changes; mirrors the state diagram in docs/erd.md section 4. */
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  [BookingStatus.PENDING]: [
    BookingStatus.CHECKED_IN,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.CHECKED_IN]: [
    BookingStatus.COMPLETED,
    BookingStatus.CHECKOUT_OVERDUE,
  ],
  [BookingStatus.CHECKOUT_OVERDUE]: [BookingStatus.COMPLETED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.EXPIRED]: [],
};

/** Statuses that hold the seat (same list as the no_double_booking WHERE clause). */
export const SEAT_HOLDING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CHECKED_IN,
  BookingStatus.CHECKOUT_OVERDUE,
];

/** Counted against booking_policies.max_active_per_user. */
export const ACTIVE_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CHECKED_IN,
];

export const FINISHED_STATUSES: readonly BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.EXPIRED,
];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(
      `Booking is ${from} and can't be changed to ${to}`,
    );
  }
}

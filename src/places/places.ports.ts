import type { EntityManager } from 'typeorm';

/**
 * Dependencies places (and seats) need from the bookings module. Bookings
 * imports places, so places can't import bookings (docs/project-structure.md
 * section 3): the token is bound by bookings (BookingsBindingsModule,
 * useExisting) and injected @Optional() here, like OutboxService.
 */

/** Why an admin change cancelled bookings; stored in booking_events.metadata.subReason. */
export type PlaceChangeSubReason =
  | 'SEAT_UNAVAILABLE'
  | 'SEAT_DELETED'
  | 'PLACE_DEACTIVATED'
  | 'PLACE_DELETED'
  | 'HOURS_CHANGED';

/**
 * Which PENDING bookings of the place an admin change makes impossible:
 *   { seatId }       every one on that seat (maintenance, unavailable, deleted)
 *   'all'            every one at the place (deactivated, deleted)
 *   'outside-hours'  the ones the new opening hours / closures no longer allow
 */
export type AffectedBookings = { seatId: string } | 'all' | 'outside-hours';

export const PLACE_CHANGE_BOOKINGS = Symbol('PLACE_CHANGE_BOOKINGS');
export interface PlaceChangeBookingsPort {
  /**
   * Cancels the affected PENDING bookings on `manager` (the admin write's own
   * transaction), with the normal cancellation alert, booking event and outbox
   * row, so the expire job never counts them as no-shows. CHECKED_IN and
   * CHECKOUT_OVERDUE bookings are never touched. Returns how many were cancelled.
   * Call it after the admin write, so the new hours/closures are what it checks.
   */
  cancelAffected(
    manager: EntityManager,
    placeId: string,
    affected: AffectedBookings,
    subReason: PlaceChangeSubReason,
    now?: Date,
  ): Promise<number>;
}

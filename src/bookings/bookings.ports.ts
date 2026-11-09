import type { EntityManager } from 'typeorm';
import type { TimeRange } from '../database/transformers/tstzrange.transformer';
import type { BookingPolicy } from '../places/entities/booking-policy.entity';

/**
 * Dependencies the bookings module needs from modules owned by teammates
 * (docs/project-structure.md section 2). Injected by token so this module
 * compiles and is unit-testable before they exist. Wiring, once they merge
 * (bookings.module.ts):
 *   imports:   [SeatsModule, PlacesModule, UsersModule, MessagingModule]
 *   providers: { provide: SEAT_LOOKUP,     useExisting: SeatsService },
 *              { provide: PLACE_RULES,     useExisting: <places service implementing PlaceRulesPort> },
 *              { provide: NO_SHOW_COUNTER, useExisting: UsersService },
 *              { provide: OUTBOX,          useExisting: OutboxService }
 * Every method that takes a `manager` must run on it, to join the caller's transaction.
 */

export interface SeatForBooking {
  id: string;
  placeId: string;
  label: string;
}

/** seats module, SeatsService. */
export const SEAT_LOOKUP = Symbol('SEAT_LOOKUP');
export interface SeatLookupPort {
  /**
   * Seats that exist, are ACTIVE and not soft-deleted, in an active, not-deleted
   * place. Unknown or unbookable ids are left out of the result.
   */
  findBookable(seatIds: string[], manager?: EntityManager): Promise<SeatForBooking[]>;
}

export interface PlaceBookingContext {
  placeId: string;
  name: string;
  /** IANA zone, e.g. Asia/Phnom_Penh. */
  timezone: string;
  policy: BookingPolicy;
}

/** places module: PlacesService + BookingPoliciesService + OpeningHoursService. */
export const PLACE_RULES = Symbol('PLACE_RULES');
export interface PlaceRulesPort {
  /** Throws NotFoundException if the place doesn't exist or is inactive. */
  getBookingContext(placeId: string, manager?: EntityManager): Promise<PlaceBookingContext>;

  /**
   * True if the place is open for the whole range: inside place_opening_hours
   * and not on a place_closures date, evaluated in the place's timezone.
   */
  isOpenForRange(placeId: string, range: TimeRange, manager?: EntityManager): Promise<boolean>;
}

/** users module, UsersService. */
export const NO_SHOW_COUNTER = Symbol('NO_SHOW_COUNTER');
export interface NoShowCounterPort {
  /** users.no_show_count + 1. */
  incrementNoShow(manager: EntityManager, userId: string): Promise<void>;
}

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  /** RabbitMQ routing key, e.g. booking.created (docs/api-endpoints.md section 9). */
  eventType: string;
  /** No secrets, tokens or password fields. */
  payload: Record<string, unknown>;
}

/** messaging module, OutboxService. */
export const OUTBOX = Symbol('OUTBOX');
export interface OutboxPort {
  /** Inserts an outbox_events row on `manager` (same transaction as the change). */
  add(manager: EntityManager, event: OutboxEventInput): Promise<void>;
}

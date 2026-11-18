import type { Seat } from './entities/seat.entity';

/**
 * Availability is derived from bookings (AGENTS.md section 6.2, docs/erd.md
 * section 7), which seats can't import (bookings -> seats). The routes live in
 * SeatsController (so /seats/available is matched before /seats/:seatId) and
 * delegate here; bookings binds the token (BookingsBindingsModule).
 */
export const SEAT_AVAILABILITY = Symbol('SEAT_AVAILABILITY');

export interface AvailableSeatsQuery {
  placeId: string;
  areaId?: string;
  start: Date;
  end: Date;
  page: number;
  limit: number;
}

export interface AvailableSeatsPage {
  items: Seat[];
  total: number;
  /** False when the place is closed during part of the window: no seat is available. */
  placeOpen: boolean;
}

export interface SeatAvailability {
  /** Seat ACTIVE in an active place the partner (if any) has open. */
  bookable: boolean;
  /** Open for the whole window (opening hours and closures, place timezone). */
  placeOpen: boolean;
  /** Someone is in the seat now: CHECKED_IN now, or any CHECKOUT_OVERDUE booking. */
  occupiedNow: boolean;
  /** Ranges held by PENDING / CHECKED_IN / CHECKOUT_OVERDUE bookings overlapping the window. */
  busy: { start: Date; end: Date }[];
  /** Bookable, open, nothing busy, and not occupied now if the window includes now. */
  available: boolean;
}

export interface SeatAvailabilityPort {
  /** 400 on a bad window, 404 if the place is unknown, inactive or deleted. */
  availableSeats(
    query: AvailableSeatsQuery,
    now?: Date,
  ): Promise<AvailableSeatsPage>;
  /** `seat` is already visible (SeatsService.findOne). 400 on a bad window. */
  seatAvailability(
    seat: Pick<Seat, 'id' | 'placeId' | 'status'>,
    start: Date,
    end: Date,
    now?: Date,
  ): Promise<SeatAvailability>;
}

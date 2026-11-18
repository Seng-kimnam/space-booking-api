import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type {
  AffectedBookings,
  PlaceChangeBookingsPort,
  PlaceChangeSubReason,
} from '../../places/places.ports';
import { PLACE_RULES } from '../bookings.ports';
import type { PlaceRulesPort } from '../bookings.ports';
import { BookingsRepository } from '../repositories/bookings.repository';
import { BookingCancellationService } from './booking-cancellation.service';

/**
 * The places module's PLACE_CHANGE_BOOKINGS port (src/places/places.ports.ts):
 * an admin made a seat or place unbookable, so its PENDING bookings are
 * cancelled in the admin's transaction instead of expiring later as no-shows.
 */
@Injectable()
export class PlaceChangeBookingsService implements PlaceChangeBookingsPort {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly cancellation: BookingCancellationService,
    @Inject(PLACE_RULES) private readonly placeRules: PlaceRulesPort,
  ) {}

  async cancelAffected(
    manager: EntityManager,
    placeId: string,
    affected: AffectedBookings,
    subReason: PlaceChangeSubReason,
    now: Date = new Date(),
  ): Promise<number> {
    let pending = await this.bookings.lockPendingAtPlace(
      manager,
      placeId,
      typeof affected === 'object' ? affected.seatId : undefined,
    );
    if (affected === 'outside-hours') {
      const closed = [];
      for (const b of pending)
        if (
          !(await this.placeRules.isOpenForRange(placeId, b.timeRange, manager))
        )
          closed.push(b);
      pending = closed;
    }
    return this.cancellation.cancelForPlaceChange(
      manager,
      pending.map((b) => ({ bookingId: b.id, subReason })),
      now,
      'ADMIN_CANCELLED',
    );
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import { BookingPolicy } from '../entities/booking-policy.entity';
import { Place } from '../entities/place.entity';
import { OpeningHoursService } from './opening-hours.service';

/**
 * The bookings module's PLACE_RULES port (src/bookings/bookings.ports.ts),
 * bound in bookings.module.ts with useExisting. Matches the port by shape, so
 * places doesn't import bookings (graph in docs/project-structure.md section 3).
 * Every method takes the caller's `manager` to join its transaction.
 */
@Injectable()
export class PlaceRulesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly hours: OpeningHoursService,
  ) {}

  /**
   * Throws 404 if the place doesn't exist, is inactive or deleted, has no
   * policy, or is partner-managed and closed by the partner (external_open).
   */
  async getBookingContext(
    placeId: string,
    manager?: EntityManager,
  ): Promise<{
    placeId: string;
    name: string;
    timezone: string;
    policy: BookingPolicy;
  }> {
    const m = manager ?? this.ds.manager;
    const place = await m.findOneBy(Place, { id: placeId, isActive: true });
    const policy = place && (await m.findOneBy(BookingPolicy, { placeId }));
    if (!place || !policy) throw new NotFoundException('Place not found');
    // Partner-managed place: the partner must also have it open for booking.
    if (place.externalOpen === false) throw new NotFoundException('Place not found');
    return { placeId, name: place.name, timezone: place.timezone, policy };
  }

  isOpenForRange(
    placeId: string,
    range: TimeRange,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.hours.isOpenForRange(placeId, range.start, range.end, manager);
  }
}

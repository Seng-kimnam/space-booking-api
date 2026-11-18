import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SeatStatus } from '../../common/enums';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import { Place } from '../../places/entities/place.entity';
import type {
  AvailableSeatsPage,
  AvailableSeatsQuery,
  SeatAvailability,
  SeatAvailabilityPort,
} from '../../seats/seats.ports';
import type { Seat } from '../../seats/entities/seat.entity';
import { PLACE_RULES } from '../bookings.ports';
import type { PlaceRulesPort } from '../bookings.ports';
import { BookingsRepository } from '../repositories/bookings.repository';

/** Bounds the busy list and the opening-hours check. */
export const MAX_WINDOW_DAYS = 31;

/**
 * The seats module's SEAT_AVAILABILITY port (src/seats/seats.ports.ts).
 * Availability is derived, never stored (AGENTS.md section 6.2): docs/erd.md
 * section 7. Informational only: POST /bookings still relies on the exclusion
 * constraint, and a seat shown free can be taken a moment later.
 */
@Injectable()
export class SeatAvailabilityService implements SeatAvailabilityPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly bookings: BookingsRepository,
    @Inject(PLACE_RULES) private readonly placeRules: PlaceRulesPort,
  ) {}

  async availableSeats(
    query: AvailableSeatsQuery,
    now: Date = new Date(),
  ): Promise<AvailableSeatsPage> {
    const range = this.window(query.start, query.end);
    // Inactive or deleted (soft-delete filter) -> 404, as for the place's seat list.
    const place = await this.dataSource.manager.findOneBy(Place, {
      id: query.placeId,
      isActive: true,
    });
    if (!place) throw new NotFoundException('Place not found');
    if (
      place.externalOpen === false ||
      !(await this.placeRules.isOpenForRange(place.id, range))
    ) {
      return { items: [], total: 0, placeOpen: false };
    }
    const { items, total } = await this.bookings.findAvailableSeats(
      place.id,
      range,
      now,
      query,
    );
    return { items, total, placeOpen: true };
  }

  async seatAvailability(
    seat: Pick<Seat, 'id' | 'placeId' | 'status'>,
    start: Date,
    end: Date,
    now: Date = new Date(),
  ): Promise<SeatAvailability> {
    const range = this.window(start, end);
    const place = await this.dataSource.manager.findOneBy(Place, {
      id: seat.placeId,
    });
    const bookable =
      seat.status === SeatStatus.ACTIVE &&
      !!place?.isActive &&
      place.externalOpen !== false;
    const [placeOpen, busy, occupiedNow] = await Promise.all([
      this.placeRules.isOpenForRange(seat.placeId, range),
      this.bookings.busyRanges(seat.id, range),
      this.bookings.isOccupiedNow(seat.id, now),
    ]);
    const windowIncludesNow = range.start <= now && now < range.end;
    return {
      bookable,
      placeOpen,
      occupiedNow,
      busy,
      available:
        bookable &&
        placeOpen &&
        busy.length === 0 &&
        !(occupiedNow && windowIncludesNow),
    };
  }

  private window(start: Date, end: Date): TimeRange {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
      throw new BadRequestException('startAt and endAt must be valid dates');
    if (end <= start)
      throw new BadRequestException('endAt must be after startAt');
    if (end.getTime() - start.getTime() > MAX_WINDOW_DAYS * 24 * 3_600_000)
      throw new BadRequestException(
        `The window can be at most ${MAX_WINDOW_DAYS} days`,
      );
    return { start, end };
  }
}

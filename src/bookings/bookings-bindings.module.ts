import { Global, Module } from '@nestjs/common';
import { PLACE_CHANGE_BOOKINGS } from '../places/places.ports';
import { SEAT_AVAILABILITY } from '../seats/seats.ports';
import { BookingsModule } from './bookings.module';
import { PlaceChangeBookingsService } from './services/place-change-bookings.service';
import { SeatAvailabilityService } from './services/seat-availability.service';

/**
 * Binds ports that lower modules declare and bookings implements:
 *   PLACE_CHANGE_BOOKINGS (src/places/places.ports.ts) -> PlaceChangeBookingsService
 *   SEAT_AVAILABILITY     (src/seats/seats.ports.ts)   -> SeatAvailabilityService
 * Global because places and seats consume them but can't import BookingsModule
 * (bookings imports them; docs/project-structure.md section 3).
 */
@Global()
@Module({
  imports: [BookingsModule],
  providers: [
    { provide: PLACE_CHANGE_BOOKINGS, useExisting: PlaceChangeBookingsService },
    { provide: SEAT_AVAILABILITY, useExisting: SeatAvailabilityService },
  ],
  exports: [PLACE_CHANGE_BOOKINGS, SEAT_AVAILABILITY],
})
export class BookingsBindingsModule {}

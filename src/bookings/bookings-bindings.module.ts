import { Global, Module } from '@nestjs/common';
import { PLACE_CHANGE_BOOKINGS } from '../places/places.ports';
import { SEAT_AVAILABILITY } from '../seats/seats.ports';
import { BookingsModule } from './bookings.module';
import { PlaceChangeBookingsService } from './services/place-change-bookings.service';
import { SeatAvailabilityService } from './services/seat-availability.service';
import { UserBookingsService } from './services/user-bookings.service';
import { USER_BOOKINGS } from '../users/users.ports';

/**
 * Binds ports that lower modules declare and bookings implements:
 *   PLACE_CHANGE_BOOKINGS (src/places/places.ports.ts) -> PlaceChangeBookingsService
 *   SEAT_AVAILABILITY     (src/seats/seats.ports.ts)   -> SeatAvailabilityService
 *   USER_BOOKINGS         (src/users/users.ports.ts)   -> UserBookingsService
 * Global because places, seats and users consume them but can't import BookingsModule
 * (bookings imports them; docs/project-structure.md section 3).
 */
@Global()
@Module({
  imports: [BookingsModule],
  providers: [
    { provide: PLACE_CHANGE_BOOKINGS, useExisting: PlaceChangeBookingsService },
    { provide: SEAT_AVAILABILITY, useExisting: SeatAvailabilityService },
    { provide: USER_BOOKINGS, useExisting: UserBookingsService },
  ],
  exports: [PLACE_CHANGE_BOOKINGS, SEAT_AVAILABILITY, USER_BOOKINGS],
})
export class BookingsBindingsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlacesModule } from '../places/places.module';
import { PlaceRulesService } from '../places/services/place-rules.service';
import { SeatsModule } from '../seats/seats.module';
import { SeatsService } from '../seats/services/seats.service';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/services/users.service';
import { NO_SHOW_COUNTER, PLACE_RULES, SEAT_LOOKUP } from './bookings.ports';
import { AdminBookingsController } from './controllers/admin-bookings.controller';
import { AttendanceController } from './controllers/attendance.controller';
import { BookingsController } from './controllers/bookings.controller';
import { BookingEvent } from './entities/booking-event.entity';
import { BookingQrToken } from './entities/booking-qr-token.entity';
import { ExternalIdentitiesModule } from '../external-identities/external-identities.module';
import { Booking } from './entities/booking.entity';
import { BookingsRepository } from './repositories/bookings.repository';
import { AttendanceService } from './services/attendance.service';
import { BookingActivityService } from './services/booking-activity.service';
import { BookingCancellationService } from './services/booking-cancellation.service';
import { BookingLifecycleService } from './services/booking-lifecycle.service';
import { BookingQrService } from './services/booking-qr.service';
import { BookingRulesService } from './services/booking-rules.service';
import { BookingsService } from './services/bookings.service';
import { PlaceChangeBookingsService } from './services/place-change-bookings.service';
import { SeatAvailabilityService } from './services/seat-availability.service';
import { UserBookingsService } from './services/user-bookings.service';

/**
 * SEAT_LOOKUP is the real SeatsService and PLACE_RULES the real PlaceRulesService.
 * OUTBOX comes from the global MessagingModule (OutboxService). NO_SHOW_COUNTER
 * is the real UsersService. GET /seats/available and /seats/:id/availability
 * are routed by SeatsController and answered by SeatAvailabilityService
 * (SEAT_AVAILABILITY port, BookingsBindingsModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, BookingEvent, BookingQrToken]),
    NotificationsModule,
    AuthModule,
    SeatsModule,
    PlacesModule,
    UsersModule,
    // Member eligibility at partner places and member ids in booking events.
    ExternalIdentitiesModule,
  ],
  controllers: [BookingsController, AttendanceController, AdminBookingsController],
  providers: [
    { provide: SEAT_LOOKUP, useExisting: SeatsService },
    { provide: PLACE_RULES, useExisting: PlaceRulesService },
    { provide: NO_SHOW_COUNTER, useExisting: UsersService },
    BookingsRepository,
    BookingRulesService,
    BookingActivityService,
    BookingQrService,
    BookingCancellationService,
    PlaceChangeBookingsService,
    SeatAvailabilityService,
    UserBookingsService,
    AttendanceService,
    BookingsService,
    BookingLifecycleService,
  ],
  exports: [
    BookingsService,
    BookingLifecycleService,
    BookingsRepository,
    // Bound to the places/seats ports by BookingsBindingsModule.
    PlaceChangeBookingsService,
    SeatAvailabilityService,
    // Bound to the users USER_BOOKINGS port by BookingsBindingsModule.
    UserBookingsService,
  ],
})
export class BookingsModule {}

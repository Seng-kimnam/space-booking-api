import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SeatsModule } from '../seats/seats.module';
import { SeatsService } from '../seats/services/seats.service';
import { SEAT_LOOKUP } from './bookings.ports';
import { AdminBookingsController } from './controllers/admin-bookings.controller';
import { AttendanceController } from './controllers/attendance.controller';
import { BookingsController } from './controllers/bookings.controller';
import { BookingEvent } from './entities/booking-event.entity';
import { BookingQrToken } from './entities/booking-qr-token.entity';
import { Booking } from './entities/booking.entity';
import { BookingsRepository } from './repositories/bookings.repository';
import { AttendanceService } from './services/attendance.service';
import { BookingActivityService } from './services/booking-activity.service';
import { BookingLifecycleService } from './services/booking-lifecycle.service';
import { BookingQrService } from './services/booking-qr.service';
import { BookingRulesService } from './services/booking-rules.service';
import { BookingsService } from './services/bookings.service';

/**
 * SEAT_LOOKUP is the real SeatsService. PLACE_RULES, NO_SHOW_COUNTER and OUTBOX
 * still come from InterimPortsModule until places, users and messaging merge
 * (see bookings.ports.ts). GET /seats/available and /seats/:id/availability
 * (seat-availability.controller) are still to do.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, BookingEvent, BookingQrToken]),
    NotificationsModule,
    AuthModule,
    SeatsModule,
  ],
  controllers: [BookingsController, AttendanceController, AdminBookingsController],
  providers: [
    { provide: SEAT_LOOKUP, useExisting: SeatsService },
    BookingsRepository,
    BookingRulesService,
    BookingActivityService,
    BookingQrService,
    AttendanceService,
    BookingsService,
    BookingLifecycleService,
  ],
  exports: [BookingsService, BookingLifecycleService, BookingsRepository],
})
export class BookingsModule {}

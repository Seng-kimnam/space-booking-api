import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
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
 * Needs SEAT_LOOKUP, PLACE_RULES, NO_SHOW_COUNTER and OUTBOX from teammates'
 * modules before it can be added to AppModule (see bookings.ports.ts).
 * GET /seats/available and /seats/:id/availability (seat-availability.controller)
 * come once the seats module exists.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, BookingEvent, BookingQrToken]),
    NotificationsModule,
  ],
  controllers: [BookingsController, AttendanceController, AdminBookingsController],
  providers: [
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

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AuthCleanupJob } from './auth-cleanup.job';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExpireBookingsJob } from './expire-bookings.job';
import { NotificationDispatchJob } from './notification-dispatch.job';
import { OverdueCheckoutsJob } from './overdue-checkouts.job';

/**
 * Requires ScheduleModule.forRoot() in AppModule. Jobs only call services
 * (docs/project-structure.md section 4). The outbox relay job belongs to the
 * messaging module's owner.
 */
@Module({
  imports: [AuthModule, BookingsModule, NotificationsModule],
  providers: [
    ExpireBookingsJob,
    OverdueCheckoutsJob,
    NotificationDispatchJob,
    AuthCleanupJob,
  ],
})
export class JobsModule {}

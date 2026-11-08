import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
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
  imports: [BookingsModule, NotificationsModule],
  providers: [ExpireBookingsJob, OverdueCheckoutsJob, NotificationDispatchJob],
})
export class JobsModule {}

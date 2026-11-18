import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AuthCleanupJob } from './auth-cleanup.job';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExpireBookingsJob } from './expire-bookings.job';
import { NotificationDispatchJob } from './notification-dispatch.job';
import { OutboxRelayJob } from './outbox-relay.job';
import { OverdueCheckoutsJob } from './overdue-checkouts.job';

/**
 * Requires ScheduleModule.forRoot() in AppModule. Jobs only call services
 * (docs/project-structure.md section 4). OutboxRelayService comes from the
 * global MessagingModule.
 */
@Module({
  imports: [AuthModule, BookingsModule, NotificationsModule],
  providers: [
    ExpireBookingsJob,
    OverdueCheckoutsJob,
    NotificationDispatchJob,
    AuthCleanupJob,
    OutboxRelayJob,
  ],
})
export class JobsModule {}

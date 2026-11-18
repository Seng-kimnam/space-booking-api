import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingLifecycleService } from '../bookings/services/booking-lifecycle.service';
import { ExclusiveRunner } from './exclusive-runner';

const BATCH = 100;

/** Not checked out by end + overdue_alert_minutes (e.g. 11:15 for 10-11) -> CHECKOUT_OVERDUE. */
@Injectable()
export class OverdueCheckoutsJob {
  private readonly runner = new ExclusiveRunner(new Logger(OverdueCheckoutsJob.name), BATCH);

  constructor(private readonly lifecycle: BookingLifecycleService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'overdue-checkouts' })
  handle(): Promise<void> {
    return this.runner.run('overdue checkouts', () =>
      this.lifecycle.markOverdue(new Date(), BATCH),
    );
  }
}

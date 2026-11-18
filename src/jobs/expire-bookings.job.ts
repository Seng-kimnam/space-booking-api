import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingLifecycleService } from '../bookings/services/booking-lifecycle.service';
import { ExclusiveRunner } from './exclusive-runner';

const BATCH = 100;

/** No check-in by start + checkin_grace_minutes (15 by default) -> EXPIRED, seat released. */
@Injectable()
export class ExpireBookingsJob {
  private readonly runner = new ExclusiveRunner(new Logger(ExpireBookingsJob.name), BATCH);

  constructor(private readonly lifecycle: BookingLifecycleService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'expire-bookings' })
  handle(): Promise<void> {
    return this.runner.run('expired bookings', () =>
      this.lifecycle.expireDue(new Date(), BATCH),
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationDispatcher } from '../notifications/services/notification-dispatcher.service';
import { ExclusiveRunner } from './exclusive-runner';

const BATCH = 50;

/** Sends due notifications (late check-in at start + 5, reminders, expiry...) every 30 s. */
@Injectable()
export class NotificationDispatchJob {
  private readonly runner = new ExclusiveRunner(new Logger(NotificationDispatchJob.name), BATCH);

  constructor(private readonly dispatcher: NotificationDispatcher) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'notification-dispatch' })
  handle(): Promise<void> {
    return this.runner.run('notifications processed', async () => {
      const s = await this.dispatcher.dispatchDue(new Date(), BATCH);
      return s.sent + s.skipped + s.retrying + s.failed;
    });
  }
}

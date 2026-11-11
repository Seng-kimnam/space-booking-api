import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthCleanupService } from '../auth/auth-cleanup.service';
import { ExclusiveRunner } from './exclusive-runner';

/** Hourly: deletes expired OTPs and refresh tokens (AuthCleanupService). */
@Injectable()
export class AuthCleanupJob {
  // One DELETE per table, not batched: maxBatches 1 means "run once per
  // tick"; ExclusiveRunner still skips a tick if the last one is running.
  private readonly runner = new ExclusiveRunner(
    new Logger(AuthCleanupJob.name),
    Number.MAX_SAFE_INTEGER,
    1,
  );

  constructor(private readonly cleanup: AuthCleanupService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'auth-cleanup' })
  handle(): Promise<void> {
    return this.runner.run('expired auth rows deleted', () =>
      this.cleanup.purgeExpired(new Date()),
    );
  }
}

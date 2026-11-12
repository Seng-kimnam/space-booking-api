import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExclusiveRunner } from '../../../jobs/exclusive-runner';
import { LibraryPlaceRepairService } from '../services/library-place-repair.service';

const BATCH = 50;

/** Hourly safety net for LMS place sync. Off while LMS_BASE_URL is empty. */
@Injectable()
export class PlaceRepairJob {
  // One batch per run; the next hour picks up the next least recently updated places.
  private readonly runner = new ExclusiveRunner(new Logger(PlaceRepairJob.name), BATCH, 1);

  constructor(private readonly repair: LibraryPlaceRepairService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'lms-place-repair' })
  async handle(): Promise<void> {
    if (!this.repair.isEnabled()) return;
    await this.runner.run('LMS places checked', () => this.repair.repairBatch(BATCH));
  }
}

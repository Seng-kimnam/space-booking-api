import { Logger } from '@nestjs/common';

/**
 * Skips a tick while the previous run of the same job is still going (in this
 * process). Cross-instance safety comes from FOR UPDATE SKIP LOCKED in the
 * queries. Repeats while a full batch came back, up to `maxBatches`.
 */
export class ExclusiveRunner {
  private running = false;

  constructor(
    private readonly logger: Logger,
    private readonly batchSize: number,
    private readonly maxBatches = 10,
  ) {}

  async run(label: string, batch: () => Promise<number>): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let total = 0;
      for (let i = 0; i < this.maxBatches; i++) {
        const done = await batch();
        total += done;
        if (done < this.batchSize) break;
      }
      if (total > 0) this.logger.log(`${label}: ${total}`);
    } catch (err) {
      this.logger.error(`${label} failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      this.running = false;
    }
  }
}

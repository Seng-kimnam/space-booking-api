import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxRelayService } from '../messaging/outbox/outbox-relay.service';
import { ExclusiveRunner } from './exclusive-runner';

const BATCH = 100;

/** Publishes outbox_events to RabbitMQ every 5 s. Does nothing while RABBITMQ_URL is empty. */
@Injectable()
export class OutboxRelayJob {
  private readonly runner = new ExclusiveRunner(new Logger(OutboxRelayJob.name), BATCH);

  constructor(private readonly relay: OutboxRelayService) {}

  @Cron(CronExpression.EVERY_5_SECONDS, { name: 'outbox-relay' })
  async handle(): Promise<void> {
    if (!this.relay.isEnabled()) return;
    await this.runner.run('outbox events published', () => this.relay.relayBatch(BATCH));
  }
}

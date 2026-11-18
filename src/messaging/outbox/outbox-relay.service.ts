import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { rabbitmqConfig } from '../../configuration/rabbitmq.config';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { RabbitPublisher } from '../rabbitmq/rabbit-publisher';
import { toMessage } from './envelope';

/**
 * Publishes unpublished outbox rows in occurred_at order (contract section 6).
 * Rows are claimed with FOR UPDATE SKIP LOCKED, so two app instances never
 * publish the same row; the lock is held until published_at is committed.
 * A crash between the broker confirm and the commit re-sends the row: that
 * duplicate is expected, consumers dedupe on message_id.
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly publisher: RabbitPublisher,
    @Inject(rabbitmqConfig.KEY)
    private readonly config: ConfigType<typeof rabbitmqConfig>,
  ) {}

  isEnabled(): boolean {
    return this.publisher.isEnabled();
  }

  /** Publishes up to `limit` rows; returns how many were published. Stops at the first failure. */
  async relayBatch(limit = this.config.relayBatch): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager
        .getRepository(OutboxEvent)
        .createQueryBuilder('o')
        .where('o.published_at IS NULL')
        .orderBy('o.occurred_at', 'ASC')
        .addOrderBy('o.id', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      let published = 0;
      for (const row of rows) {
        try {
          await this.publisher.publishConfirmed(toMessage(row));
        } catch (err) {
          // Stored for operators (outbox_events.last_error), not logged.
          const reason = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error';
          await manager
            .createQueryBuilder()
            .update(OutboxEvent)
            .set({ attempts: () => 'LEAST(attempts + 1, 32767)', lastError: reason.slice(0, 500) })
            .where('id = :id', { id: row.id })
            .execute();
          this.logger.warn(`Outbox ${row.id} (${row.eventType}) not published, retrying next tick`);
          // Keep the order: later rows wait for this one.
          break;
        }
        await manager.update(OutboxEvent, row.id, { publishedAt: new Date() });
        published++;
      }
      return published;
    });
  }
}

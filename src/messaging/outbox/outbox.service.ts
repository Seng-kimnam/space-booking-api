import { Injectable } from '@nestjs/common';
import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import { OutboxEvent } from '../entities/outbox-event.entity';

/** Same shape as OutboxEventInput in bookings.ports.ts (messaging has no domain imports). */
export interface NewOutboxEvent {
  aggregateType: string;
  aggregateId: string;
  /** RabbitMQ routing key, e.g. booking.created (docs/api-endpoints.md section 9). */
  eventType: string;
  /** No secrets, tokens or password fields. May carry `schemaVersion` (default 1). */
  payload: Record<string, unknown>;
}

/**
 * Implements the OUTBOX port (AGENTS.md section 6.11): the row is written on
 * the caller's transaction, so an event exists if and only if the change
 * committed. The outbox relay publishes it later.
 */
@Injectable()
export class OutboxService {
  async add(manager: EntityManager, event: NewOutboxEvent): Promise<void> {
    // QueryDeepPartialEntity can't express a free-form jsonb Record; the fields match the entity.
    await manager
      .getRepository(OutboxEvent)
      .insert(event as QueryDeepPartialEntity<OutboxEvent>);
  }
}

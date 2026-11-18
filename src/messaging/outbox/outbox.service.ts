import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import { PoisonMessageError, SchemaValidator } from '../contract/schema-validator';
import { isPublishedType } from '../contract/schemas';
import type { PublishedMessageType } from '../contract/schemas';
import type { PublishedPayloads } from '../contract/types';
import { OutboxEvent } from '../entities/outbox-event.entity';

/** Payload as written to the outbox: the contract `data` plus its schema version. */
export type OutboxPayload<K extends PublishedMessageType> = PublishedPayloads[K] & {
  schemaVersion: number;
};

/** Same shape as OutboxEventInput in bookings.ports.ts (messaging has no domain imports). */
export interface NewOutboxEvent<K extends PublishedMessageType = PublishedMessageType> {
  aggregateType: string;
  aggregateId: string;
  /** A routing key we publish (MessageType in contract/schemas.ts). */
  eventType: K;
  /** No secrets, tokens or password fields. */
  payload: OutboxPayload<K>;
}

/** A producer tried to publish something the contract doesn't allow. A bug, never data. */
export class ContractViolationError extends Error {
  override readonly name = 'ContractViolationError';
}

/**
 * Implements the OUTBOX port (AGENTS.md section 6.11): the row is written on
 * the caller's transaction, so an event exists if and only if the change
 * committed. The outbox relay publishes it later.
 *
 * The contract is enforced here, at write time
 * (docs/integration/lms-message-contract.md): only routing keys we publish are
 * accepted, and the payload must match its JSON Schema. A violation throws, so
 * the caller's whole change rolls back instead of a partner getting bad data.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly schemas: SchemaValidator) {}

  async add<K extends PublishedMessageType>(manager: EntityManager, event: NewOutboxEvent<K>): Promise<void> {
    this.assertContract(event);
    // QueryDeepPartialEntity can't express a free-form jsonb Record; the fields match the entity.
    await manager
      .getRepository(OutboxEvent)
      .insert(event as unknown as QueryDeepPartialEntity<OutboxEvent>);
  }

  private assertContract(event: { eventType: string; payload: { schemaVersion?: unknown } }): void {
    const { eventType } = event;
    if (!isPublishedType(eventType))
      throw new ContractViolationError(`${eventType} is not a message Space Booking publishes`);
    const { schemaVersion, ...data } = event.payload as Record<string, unknown>;
    const version = typeof schemaVersion === 'number' ? schemaVersion : 1;
    try {
      this.schemas.assertData(eventType, version, data);
    } catch (err) {
      const reason = err instanceof PoisonMessageError ? err.message : String(err);
      // Type and reason only: never the payload.
      this.logger.error(`Refused to publish ${eventType} v${version}: ${reason}`);
      throw new ContractViolationError(`${eventType} v${version} does not match the contract: ${reason}`);
    }
  }
}

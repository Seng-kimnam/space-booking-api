import type { ConsumeMessage, Options } from 'amqplib';
import type { EntityManager } from 'typeorm';

/** A validated incoming envelope (docs/integration/messaging-contract.md section 3.2). */
export interface IncomingEnvelope<T = Record<string, unknown>> {
  id: string;
  type: string;
  version: number;
  source: string;
  occurredAt: string;
  correlationId: string | null;
  subject: { type: string; id: string };
  data: T;
}

/**
 * Runs inside the inbox transaction: write everything through `manager`
 * (including outbox rows) so it commits or rolls back with the inbox row.
 * Throw for transient errors (retried); return normally for business
 * rejections (publish a reply fact instead).
 */
export type MessageHandler = (manager: EntityManager, envelope: IncomingEnvelope) => Promise<void>;

/** One queue we own, bound to one partner exchange. */
export interface ConsumerRoute {
  /** Our queue, e.g. space-booking.library-events. Retry and DLQ queues get .retry / .dlq. */
  queue: string;
  /** Routing key of this queue inside space-booking.dlx, e.g. library-events. */
  dlxKey: string;
  /** Broker user (= app_id = envelope source) we accept messages from. */
  producer: string;
  /** The producer's exchange, e.g. library.events. Declared by the producer, not us. */
  exchange: string;
  /** Message types we handle; each key is bound one by one (never '#'). */
  handlers: Record<string, MessageHandler>;
}

/** The part of an amqp channel the runner needs (ChannelWrapper or a test fake). */
export interface ConsumerChannel {
  ack(message: ConsumeMessage): void;
  nack(message: ConsumeMessage, allUpTo?: boolean, requeue?: boolean): void;
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: Options.Publish,
  ): Promise<unknown>;
}

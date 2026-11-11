import { registerAs } from '@nestjs/config';

// RabbitMQ (docs/integration/messaging-contract.md). The URL holds the broker
// password: never log it.
export const rabbitmqConfig = registerAs('rabbitmq', () => ({
  // Empty = messaging off: the outbox relay does nothing and rows stay unpublished
  // until it is set (the app must work without the broker, contract principle 1).
  url: process.env.RABBITMQ_URL ?? '',
  // We publish only to our own exchange (contract section 2).
  exchange: 'space-booking.events',
  // Outbox rows claimed per relay transaction.
  relayBatch: Number(process.env.OUTBOX_RELAY_BATCH ?? 100),
  // A publish not confirmed by the broker within this time counts as failed.
  publishTimeoutMs: 10_000,
  // Consumers: unacked messages per channel, attempts before the DLQ, and the
  // TTL of <queue>.retry. Changing the TTL of an existing queue needs the queue
  // deleted first (RabbitMQ refuses different arguments).
  prefetch: Number(process.env.RABBITMQ_PREFETCH ?? 10),
  maxAttempts: Number(process.env.RABBITMQ_MAX_ATTEMPTS ?? 5),
  retryDelayMs: Number(process.env.RABBITMQ_RETRY_DELAY_MS ?? 30_000),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsumeMessage } from 'amqplib';
import type { EntityManager } from 'typeorm';
import { SchemaValidator } from '../contract/schema-validator';
import type { InboxEntry, InboxService } from '../inbox/inbox.service';
import type { RabbitConnection } from '../rabbitmq/rabbitmq.connection';
import type { ConsumerChannel, ConsumerRoute, MessageHandler } from './consumer-route';
import { ConsumerRunner, DLX } from './consumer-runner';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../docs/integration/fixtures/place.updated.v1.json'), 'utf-8'),
) as { body: Record<string, unknown> };

function delivery(
  overrides: { body?: unknown; props?: Record<string, unknown>; deaths?: number } = {},
): ConsumeMessage {
  const body = overrides.body ?? fixture.body;
  return {
    content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    fields: {} as ConsumeMessage['fields'],
    properties: {
      messageId: fixture.body.id,
      type: 'place.updated',
      appId: 'library',
      userId: 'library',
      contentType: 'application/json',
      headers: overrides.deaths
        ? { 'x-death': [{ queue: 'space-booking.library-events', reason: 'rejected', count: overrides.deaths }] }
        : {},
      ...overrides.props,
    } as ConsumeMessage['properties'],
  };
}

function setup(handler: MessageHandler, inboxSeen = new Set<string>()) {
  const calls: string[] = [];
  const published: { exchange: string; key: string; headers: Record<string, unknown> }[] = [];
  const channel: ConsumerChannel = {
    ack: () => calls.push('ack'),
    nack: (_m, _all, requeue) => calls.push(`nack:${String(requeue)}`),
    publish: async (exchange, key, _content, options) => {
      published.push({ exchange, key, headers: (options?.headers ?? {}) as Record<string, unknown> });
      return true;
    },
  };
  // Mimics InboxService: duplicate -> false; handler error -> nothing recorded.
  const inbox = {
    async handleOnce(entry: InboxEntry, h: (m: EntityManager) => Promise<void>) {
      if (inboxSeen.has(entry.messageId)) return false;
      await h({} as EntityManager);
      inboxSeen.add(entry.messageId);
      return true;
    },
  } as unknown as InboxService;
  const runner = new ConsumerRunner(
    { isEnabled: () => false } as unknown as RabbitConnection,
    new SchemaValidator(),
    inbox,
    { maxAttempts: 5, prefetch: 10, retryDelayMs: 30000 } as never,
  );
  const route: ConsumerRoute = {
    queue: 'space-booking.library-events',
    dlxKey: 'library-events',
    producer: 'library',
    exchange: 'library.events',
    handlers: { 'place.updated': handler },
  };
  return { runner, route, channel, calls, published };
}

describe('ConsumerRunner.handle', () => {
  it('runs the handler once and acks; a duplicate is acked without running it', async () => {
    const handler = jest.fn(async () => undefined);
    const { runner, route, channel, calls } = setup(handler);
    await runner.handle(delivery(), route, channel);
    await runner.handle(delivery(), route, channel);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['ack', 'ack']);
  });

  it.each([
    ['missing user_id', { props: { userId: undefined } }],
    ['another sender', { props: { userId: 'space-booking', appId: 'space-booking' } }],
    ['invalid JSON', { body: '{nope' }],
    ['envelope / properties mismatch', { props: { type: 'place.created' } }],
    ['schema violation', { body: { ...fixture.body, data: { placeId: '1' } } }],
  ])('sends a poison message (%s) to the DLQ without user_id, then acks', async (_, over) => {
    const handler = jest.fn(async () => undefined);
    const { runner, route, channel, calls, published } = setup(handler);
    await runner.handle(delivery(over), route, channel);
    expect(handler).not.toHaveBeenCalled();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ exchange: DLX, key: 'library-events.dlq' });
    expect(published[0].headers['x-error']).toBeTruthy();
    expect(calls).toEqual(['ack']);
  });

  it('acks and ignores a type it has no handler for', async () => {
    const { runner, route, channel, calls, published } = setup(jest.fn());
    const body = { ...fixture.body, type: 'place.archived' };
    await runner.handle(delivery({ body, props: { type: 'place.archived' } }), route, channel);
    expect(calls).toEqual(['ack']);
    expect(published).toHaveLength(0);
  });

  it('nacks a transient failure (to the retry queue) and DLQs it on the last attempt', async () => {
    const handler = jest.fn(async () => {
      throw new Error('deadlock detected');
    });
    const { runner, route, channel, calls, published } = setup(handler);
    await runner.handle(delivery({ deaths: 0 }), route, channel);
    await runner.handle(delivery({ deaths: 3 }), route, channel);
    expect(calls).toEqual(['nack:false', 'nack:false']);
    expect(published).toHaveLength(0);

    await runner.handle(delivery({ deaths: 4 }), route, channel); // 5th attempt
    expect(calls).toEqual(['nack:false', 'nack:false', 'ack']);
    expect(published[0].headers).toMatchObject({ 'x-attempts': 5, 'x-original-user-id': 'library' });
  });
});

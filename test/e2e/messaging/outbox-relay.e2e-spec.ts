import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { rabbitmqConfig } from '../../../src/configuration';
import { dataSourceOptions } from '../../../src/database/data-source';
import { OutboxEvent } from '../../../src/messaging/entities/outbox-event.entity';
import { MessagingModule } from '../../../src/messaging/messaging.module';
import type { OutgoingMessage } from '../../../src/messaging/outbox/envelope';
import { OutboxRelayService } from '../../../src/messaging/outbox/outbox-relay.service';
import { RabbitPublisher } from '../../../src/messaging/rabbitmq/rabbit-publisher';

/**
 * Outbox relay against a REAL Postgres with a fake broker: order, marking,
 * failure handling and SKIP LOCKED. Our rows get occurred_at in 1970 so they
 * are claimed before anything other suites left unpublished.
 */
describe('Outbox relay (e2e)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let relay: OutboxRelayService;

  const sent: OutgoingMessage[] = [];
  let failOn: string | null = null;
  const fakePublisher = {
    isEnabled: () => true,
    async publishConfirmed(message: OutgoingMessage) {
      // Yield, so concurrent relay calls really overlap.
      await new Promise((r) => setTimeout(r, 5));
      if (message.properties.messageId === failOn) throw new Error('nack');
      sent.push(message);
    },
  };

  const ids: string[] = [];
  const sentIds = () => sent.map((m) => m.properties.messageId).filter((id) => ids.includes(id));

  /** Inserts `n` unpublished booking rows, 1 s apart in 1970, oldest first. */
  async function insertRows(n: number): Promise<string[]> {
    const created: string[] = [];
    for (let i = 0; i < n; i++) {
      const result = await ds.getRepository(OutboxEvent).insert({
        aggregateType: 'booking',
        aggregateId: randomUUID(),
        eventType: 'booking.created',
        payload: { schemaVersion: 1, status: 'PENDING' },
        occurredAt: new Date((ids.length + i) * 1000),
      });
      created.push(result.identifiers[0].id as string);
    }
    ids.push(...created);
    return created;
  }

  beforeAll(async () => {
    if (!process.env.DB_NAME?.endsWith('_test')) {
      throw new Error('Run against a dedicated *_test database: DB_NAME=..._test npm run test:e2e');
    }
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [rabbitmqConfig] }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, migrations: [] }),
        MessagingModule,
      ],
    })
      .overrideProvider(RabbitPublisher)
      .useValue(fakePublisher)
      .compile();
    ds = moduleRef.get(DataSource);
    relay = moduleRef.get(OutboxRelayService);
  });

  beforeEach(() => {
    sent.length = 0;
    failOn = null;
  });

  afterAll(async () => {
    if (ids.length) await ds.query('DELETE FROM outbox_events WHERE id = ANY($1)', [ids]);
    await moduleRef?.close();
  });

  it('publishes in occurred_at order and marks rows published', async () => {
    const rows = await insertRows(3);
    const published = await relay.relayBatch(3);

    expect(published).toBe(3);
    expect(sentIds()).toEqual(rows);
    const marked: { count: number }[] = await ds.query(
      'SELECT count(*)::int AS count FROM outbox_events WHERE id = ANY($1) AND published_at IS NOT NULL',
      [rows],
    );
    expect(marked[0].count).toBe(3);
    expect(sent[0].body.source).toBe('space-booking');
    expect(sent[0].body.data).toEqual({
      status: 'PENDING',
      previousStartAt: null,
      previousEndAt: null,
      cancelReason: null,
      external: null,
    });
  });

  it('stops at a failed publish, records the attempt and keeps later rows', async () => {
    const [first, second, third] = await insertRows(3);
    failOn = second;

    expect(await relay.relayBatch(3)).toBe(1);
    expect(sentIds()).toEqual([first]);
    const state: { id: string; published: boolean; attempts: number; last_error: string | null }[] =
      await ds.query(
        `SELECT id, published_at IS NOT NULL AS published, attempts, last_error
           FROM outbox_events WHERE id = ANY($1)`,
        [[second, third]],
      );
    const byId = new Map(state.map((s) => [s.id, s]));
    expect(byId.get(second)).toMatchObject({ published: false, attempts: 1 });
    expect(byId.get(second)!.last_error).toContain('nack');
    expect(byId.get(third)).toMatchObject({ published: false, attempts: 0 });

    // Next tick: the broker is back, both go out in order.
    failOn = null;
    sent.length = 0;
    expect(await relay.relayBatch(2)).toBe(2);
    expect(sentIds()).toEqual([second, third]);
  });

  it('never publishes a row twice when two relays run at once (SKIP LOCKED)', async () => {
    const rows = await insertRows(6);
    await Promise.all([relay.relayBatch(6), relay.relayBatch(6)]);

    const mine = sentIds();
    expect(new Set(mine).size).toBe(mine.length);
    expect([...mine].sort()).toEqual([...rows].sort());
  });
});

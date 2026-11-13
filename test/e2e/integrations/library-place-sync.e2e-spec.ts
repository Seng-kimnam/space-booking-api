import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { NO_SHOW_COUNTER } from '../../../src/bookings/bookings.ports';
import {
  appConfig,
  bookingConfig,
  integrationsConfig,
  rabbitmqConfig,
  telegramConfig,
} from '../../../src/configuration';
import { dataSourceOptions } from '../../../src/database/data-source';
import { LibraryIntegrationModule } from '../../../src/integrations/library/library-integration.module';
import { LibraryPlaceSyncService } from '../../../src/integrations/library/library-place-sync.service';
import type { IncomingEnvelope } from '../../../src/messaging/consumers/consumer-route';
import type { PlaceSnapshotV1 } from '../../../src/messaging/contract/types';
import { InboxService } from '../../../src/messaging/inbox/inbox.service';
import { MessagingModule } from '../../../src/messaging/messaging.module';
import { TelegramBotClient } from '../../../src/telegram/telegram-bot.client';
import { TELEGRAM_LINK_CODES } from '../../../src/telegram/telegram.ports';

/** Ports no module provides yet (users, OTP); the real OUTBOX/INBOX come from MessagingModule. */
@Global()
@Module({
  providers: [
    { provide: NO_SHOW_COUNTER, useValue: { incrementNoShow: async () => undefined } },
    { provide: TELEGRAM_LINK_CODES, useValue: { issue: jest.fn(), consume: jest.fn() } },
  ],
  exports: [NO_SHOW_COUNTER, TELEGRAM_LINK_CODES],
})
class RemainingPortsModule {}

/**
 * LMS place snapshots applied to a REAL Postgres through the real inbox,
 * outbox and booking cancellation (docs/lms-integration-proposal.md section 6.1).
 */
describe('LMS place sync (e2e)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sync: LibraryPlaceSyncService;
  let inbox: InboxService;

  const run = Date.now().toString(36);
  const lmsPlaceId = `e2e-${run}`;
  const userIds: string[] = [];
  const messageIds: string[] = [];
  let sbPlaceId: string;

  const fixture = JSON.parse(
    readFileSync(join(__dirname, '../../../docs/integration/fixtures/place.updated.v1.json'), 'utf-8'),
  ) as { body: IncomingEnvelope<PlaceSnapshotV1> };

  /** A snapshot of our test place at `revision`, from the example message. */
  function snapshot(revision: number, change: (s: PlaceSnapshotV1) => void = () => undefined): PlaceSnapshotV1 {
    const s = structuredClone(fixture.body.data);
    s.placeId = lmsPlaceId;
    s.revision = revision;
    s.name = `LMS e2e ${run}`;
    // Open every day, all day, so hours never cancel the test bookings by accident.
    s.openingHours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: '00:00',
      close: '00:00',
      closesNextDay: true,
    }));
    s.closures = [];
    change(s);
    return s;
  }

  /** Delivers a snapshot the way the consumer does: inbox + handler in one transaction. */
  async function deliver(s: PlaceSnapshotV1, type = 'place.updated') {
    const id = randomUUID();
    messageIds.push(id);
    const envelope = { ...fixture.body, id, type, data: s } as unknown as IncomingEnvelope;
    let outcome: Awaited<ReturnType<LibraryPlaceSyncService['apply']>> | undefined;
    await inbox.handleOnce(
      { source: 'library', messageId: id, eventType: type, payload: {} },
      async (m) => {
        outcome = await sync.apply(m, envelope);
      },
    );
    return { id, outcome: outcome! };
  }

  const outboxFor = (eventType: string): Promise<{ payload: Record<string, unknown> }[]> =>
    ds.query(
      `SELECT payload FROM outbox_events WHERE event_type = $1 AND payload->>'placeId' = $2 ORDER BY occurred_at`,
      [eventType, lmsPlaceId],
    );

  const seatsByLabel = async (): Promise<Map<string, { id: string; external_id: string; deleted: boolean; status: string }>> => {
    const rows: { id: string; label: string; external_id: string; deleted: boolean; status: string }[] =
      await ds.query(
        `SELECT id, label, external_id, deleted_at IS NOT NULL AS deleted, status FROM seats WHERE place_id = $1`,
        [sbPlaceId],
      );
    return new Map(rows.map((r) => [r.label, r]));
  };

  beforeAll(async () => {
    if (!process.env.DB_NAME?.endsWith('_test')) {
      throw new Error('Run against a dedicated *_test database: DB_NAME=..._test npm run test:e2e');
    }
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, bookingConfig, telegramConfig, rabbitmqConfig, integrationsConfig],
        }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, migrations: [] }),
        RemainingPortsModule,
        MessagingModule,
        LibraryIntegrationModule,
      ],
    })
      .overrideProvider(TelegramBotClient)
      .useValue({ isConfigured: false, sendMessage: jest.fn() })
      .compile();
    ds = moduleRef.get(DataSource);
    sync = moduleRef.get(LibraryPlaceSyncService);
    inbox = moduleRef.get(InboxService);
  });

  afterAll(async () => {
    if (ds?.isInitialized && sbPlaceId) {
      const bookingIds = `SELECT b.id FROM bookings b JOIN seats s ON s.id = b.seat_id WHERE s.place_id = $1`;
      await ds.query(`DELETE FROM outbox_events WHERE aggregate_id IN (${bookingIds}) OR aggregate_id = $1`, [sbPlaceId]);
      await ds.query(`DELETE FROM outbox_events WHERE payload->>'placeId' = $1`, [lmsPlaceId]);
      await ds.query(`DELETE FROM notifications WHERE booking_id IN (${bookingIds})`, [sbPlaceId]);
      await ds.query(`DELETE FROM booking_events WHERE booking_id IN (${bookingIds})`, [sbPlaceId]);
      await ds.query(`DELETE FROM booking_qr_tokens WHERE booking_id IN (${bookingIds})`, [sbPlaceId]);
      await ds.query(`DELETE FROM bookings WHERE id IN (${bookingIds})`, [sbPlaceId]);
      await ds.query('DELETE FROM seats WHERE place_id = $1', [sbPlaceId]);
      await ds.query('DELETE FROM areas WHERE place_id = $1', [sbPlaceId]);
      await ds.query('DELETE FROM place_opening_hours WHERE place_id = $1', [sbPlaceId]);
      await ds.query('DELETE FROM place_closures WHERE place_id = $1', [sbPlaceId]);
      await ds.query('DELETE FROM booking_policies WHERE place_id = $1', [sbPlaceId]);
      await ds.query('DELETE FROM places WHERE id = $1', [sbPlaceId]);
      await ds.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    }
    if (ds?.isInitialized && messageIds.length)
      await ds.query(`DELETE FROM inbox_events WHERE source = 'library' AND message_id = ANY($1)`, [messageIds]);
    await moduleRef?.close();
  });

  it('creates the place from the first snapshot, inactive, and replies place.sync_applied', async () => {
    const { outcome } = await deliver(snapshot(1), 'place.created');
    expect(outcome.result).toBe('applied');
    sbPlaceId = (outcome as { placeId: string }).placeId;

    const [place] = await ds.query(
      `SELECT type, is_active, external_system, external_id, external_revision, external_open, timezone FROM places WHERE id = $1`,
      [sbPlaceId],
    );
    expect(place).toMatchObject({
      type: 'LIBRARY',
      is_active: false,
      external_system: 'library',
      external_id: lmsPlaceId,
      external_revision: '1',
      external_open: true,
    });
    const [{ count: policies }] = await ds.query(
      'SELECT count(*)::int AS count FROM booking_policies WHERE place_id = $1',
      [sbPlaceId],
    );
    expect(policies).toBe(1);
    expect([...(await seatsByLabel()).keys()].sort()).toEqual(['QZ-01', 'RR-12', 'RR-13']);

    const replies = await outboxFor('place.sync_applied');
    expect(replies).toHaveLength(1);
    expect(replies[0].payload).toMatchObject({ revision: 1, sbPlaceId, bookingOpen: false, cancelledBookings: 0 });
    expect(replies[0].payload.seats).toHaveLength(3);
  });

  it('ignores an older or equal revision', async () => {
    const { outcome } = await deliver(snapshot(1, (s) => (s.name = 'should not apply')));
    expect(outcome.result).toBe('stale');
    expect(await outboxFor('place.sync_applied')).toHaveLength(1);
  });

  it('a duplicate message id is processed once (inbox)', async () => {
    const s = snapshot(2);
    const id = randomUUID();
    messageIds.push(id);
    const envelope = { ...fixture.body, id, data: s } as unknown as IncomingEnvelope;
    const handle = () =>
      inbox.handleOnce({ source: 'library', messageId: id, eventType: 'place.updated', payload: {} }, (m) =>
        sync.apply(m, envelope).then(() => undefined),
      );
    expect(await handle()).toBe(true);
    expect(await handle()).toBe(false);
    expect(await outboxFor('place.sync_applied')).toHaveLength(2);
  });

  it('swaps labels, removes a seat and its empty area, and cancels the future booking on that seat', async () => {
    await ds.query('UPDATE places SET is_active = true WHERE id = $1', [sbPlaceId]);
    const [{ id: userId }] = await ds.query(
      `INSERT INTO users (name, email, role_id, password_hash) VALUES ('LMS e2e', $1, (SELECT id FROM roles WHERE name = 'USER'), 'test-hash') RETURNING id`,
      [`lms-e2e-${run}@example.test`],
    );
    userIds.push(userId);
    const before = await seatsByLabel();
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    tomorrow.setUTCMinutes(0, 0, 0);
    const end = new Date(tomorrow.getTime() + 3600_000);
    const [{ id: bookingOnRemoved }] = await ds.query(
      `INSERT INTO bookings (seat_id, user_id, time_range) VALUES ($1, $2, tstzrange($3, $4, '[)')) RETURNING id`,
      [before.get('QZ-01')!.id, userId, tomorrow, end],
    );
    const [{ id: bookingOnKept }] = await ds.query(
      `INSERT INTO bookings (seat_id, user_id, time_range) VALUES ($1, $2, tstzrange($3, $4, '[)')) RETURNING id`,
      [before.get('RR-12')!.id, userId, tomorrow, end],
    );

    const { outcome } = await deliver(
      snapshot(3, (s) => {
        s.seats = s.seats.filter((x) => x.seatId !== '71'); // QZ-01 removed
        s.areas = s.areas.filter((a) => a.areaId !== '4'); // its area too
        const [a, b] = s.seats;
        [a.label, b.label] = [b.label, a.label]; // RR-12 <-> RR-13
        b.status = 'ACTIVE';
      }),
    );
    expect(outcome).toMatchObject({ result: 'applied', cancelledBookings: 1 });

    const after = await seatsByLabel();
    // Same rows, labels swapped (ids kept, so bookings stay on the physical seat).
    expect(after.get('RR-13')!.id).toBe(before.get('RR-12')!.id);
    expect(after.get('RR-12')!.id).toBe(before.get('RR-13')!.id);
    expect(after.get('QZ-01')!.deleted).toBe(true);
    const [{ count: liveAreas }] = await ds.query(
      'SELECT count(*)::int AS count FROM areas WHERE place_id = $1 AND deleted_at IS NULL',
      [sbPlaceId],
    );
    expect(liveAreas).toBe(1);

    const statuses: { id: string; status: string; cancel_reason: string | null }[] = await ds.query(
      'SELECT id, status, cancel_reason FROM bookings WHERE id = ANY($1)',
      [[bookingOnRemoved, bookingOnKept]],
    );
    const byId = new Map(statuses.map((r) => [r.id, r]));
    expect(byId.get(bookingOnRemoved)!.status).toBe('CANCELLED');
    expect(byId.get(bookingOnKept)!.status).toBe('PENDING');

    const [cancelled] = await ds.query(
      `SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'booking.cancelled'`,
      [bookingOnRemoved],
    );
    expect(cancelled.payload).toMatchObject({
      cancelReason: 'LIBRARY_PLACE_CHANGED',
      actor: { system: true },
      external: { system: 'library', placeId: lmsPlaceId, seatId: '71', memberId: null },
    });
  });

  it('restores a seat that comes back, keeping its id', async () => {
    const removed = (await seatsByLabel()).get('QZ-01')!;
    await deliver(snapshot(4));
    const back = (await seatsByLabel()).get('QZ-01')!;
    expect(back.id).toBe(removed.id);
    expect(back.deleted).toBe(false);
  });

  it('rejects a snapshot that breaks our rules, keeps the last revision and replies place.sync_rejected', async () => {
    const { outcome } = await deliver(snapshot(5, (s) => (s.seats[1].label = s.seats[0].label)));
    expect(outcome).toEqual({ result: 'rejected', code: 'SEAT_LABEL_CONFLICT' });
    const [place] = await ds.query('SELECT external_revision FROM places WHERE id = $1', [sbPlaceId]);
    expect(place.external_revision).toBe('4');
    const rejected = await outboxFor('place.sync_rejected');
    expect(rejected.at(-1)!.payload).toMatchObject({ revision: 5, code: 'SEAT_LABEL_CONFLICT' });
  });

  it('closing the place in LMS makes it unbookable and cancels future bookings', async () => {
    const [{ id: userId }] = await ds.query(
      `INSERT INTO users (name, email, role_id, password_hash) VALUES ('LMS e2e 2', $1, (SELECT id FROM roles WHERE name = 'USER'), 'test-hash') RETURNING id`,
      [`lms-e2e2-${run}@example.test`],
    );
    userIds.push(userId);
    const seat = (await seatsByLabel()).get('RR-13')!;
    const start = new Date(Date.now() + 48 * 3600_000);
    start.setUTCMinutes(0, 0, 0);
    const [{ id }] = await ds.query(
      `INSERT INTO bookings (seat_id, user_id, time_range) VALUES ($1, $2, tstzrange($3, $4, '[)')) RETURNING id`,
      [seat.id, userId, start, new Date(start.getTime() + 3600_000)],
    );
    const { outcome } = await deliver(snapshot(6, (s) => (s.bookingEnabled = false)));
    expect(outcome).toMatchObject({ result: 'applied' });
    const [row] = await ds.query('SELECT status FROM bookings WHERE id = $1', [id]);
    expect(row.status).toBe('CANCELLED');
    const replies = await outboxFor('place.sync_applied');
    expect(replies.at(-1)!.payload).toMatchObject({ revision: 6, bookingOpen: false });
  });
});

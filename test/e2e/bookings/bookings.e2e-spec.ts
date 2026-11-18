// Accept QR check-in up to 30 min early, so a booking starting "soon" can be scanned now.
process.env.QR_CHECKIN_EARLY_MINUTES = '30';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { BookingsModule } from '../../../src/bookings/bookings.module';
import { AttendanceService } from '../../../src/bookings/services/attendance.service';
import { BookingLifecycleService } from '../../../src/bookings/services/booking-lifecycle.service';
import { BookingQrService } from '../../../src/bookings/services/booking-qr.service';
import { BookingsService } from '../../../src/bookings/services/bookings.service';
import { BookingStatus, QrPurpose, UserRole } from '../../../src/common/enums';
import type { AuthUser } from '../../../src/common/types/auth-user';
import { bookingConfig, telegramConfig } from '../../../src/configuration';
import { dataSourceOptions } from '../../../src/database/data-source';
import { NotificationDispatcher } from '../../../src/notifications/services/notification-dispatcher.service';
import { TelegramBotClient } from '../../../src/telegram/telegram-bot.client';
import { TestPortsModule, testPlaceRules } from '../../utils/test-ports.module';
import { PLACE_RULES } from '../../../src/bookings/bookings.ports';

/**
 * Bookings against a REAL Postgres (AGENTS.md section 10): the exclusion
 * constraint is the thing under test. Service level, no HTTP, because the auth
 * guards aren't merged yet. Jobs are driven with a fake `now`, so this must run
 * on a dedicated *_test database:
 *   DB_NAME=space_booking_db_test npm run test:e2e
 */
const SLOT_MS = 15 * 60_000;
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
const ceilSlot = (d: Date) => new Date(Math.ceil(d.getTime() / SLOT_MS) * SLOT_MS);
const iso = (d: Date) => d.toISOString();

describe('Bookings (integration, real Postgres)', () => {
  const run = randomUUID().slice(0, 8);
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  const userIds: string[] = [];
  let moduleRef: TestingModule;
  let ds: DataSource;
  let bookings: BookingsService;
  let qr: BookingQrService;
  let attendance: AttendanceService;
  let lifecycle: BookingLifecycleService;
  let dispatcher: NotificationDispatcher;
  let placeId: string;
  let s1: string;
  let s2: string;
  let s3: string;
  // Tomorrow, on a slot boundary: far enough that no rule rejects it as past.
  const day = ceilSlot(plus(new Date(), 24 * 60));

  let userSeq = 0;
  async function newUser(role: UserRole = UserRole.USER): Promise<AuthUser> {
    // Taken before the await, so parallel calls get distinct emails.
    const n = userSeq++;
    const [{ id }] = await ds.query(
      // role_id since migration 1794161000000-UserRoleRelation dropped users.role;
      // password_hash because CHK_users_has_credential (1794329131663-AddGoogleLogin).
      `INSERT INTO users (name, email, role_id, password_hash)
       VALUES ($1, $2, (SELECT id FROM roles WHERE name = $3), 'test-hash') RETURNING id`,
      ['Test', `it-${run}-${n}@example.test`, role],
    );
    userIds.push(id);
    return { id, role };
  }

  const book = (user: AuthUser, seatIds: string[], start: Date, minutes = 60, key?: string) =>
    bookings.create(user, { seatIds, startAt: iso(start), endAt: iso(plus(start, minutes)) }, key);

  const statusOf = async (id: string) =>
    (await ds.query('SELECT status FROM bookings WHERE id = $1', [id]))[0].status as BookingStatus;

  beforeAll(async () => {
    if (!process.env.DB_NAME?.endsWith('_test')) {
      throw new Error('Run against a dedicated *_test database: DB_NAME=..._test npm run test:e2e');
    }
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [bookingConfig, telegramConfig] }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, migrations: [] }),
        TestPortsModule,
        BookingsModule,
      ],
    })
      .overrideProvider(TelegramBotClient)
      .useValue({ isConfigured: true, sendMessage })
      // Opening hours aren't under test here; places e2e covers isOpenForRange.
      .overrideProvider(PLACE_RULES)
      .useFactory({ factory: testPlaceRules, inject: [DataSource] })
      .compile();

    ds = moduleRef.get(DataSource);
    bookings = moduleRef.get(BookingsService);
    qr = moduleRef.get(BookingQrService);
    attendance = moduleRef.get(AttendanceService);
    lifecycle = moduleRef.get(BookingLifecycleService);
    dispatcher = moduleRef.get(NotificationDispatcher, { strict: false });

    [{ id: placeId }] = await ds.query(
      `INSERT INTO places (name, type, address, timezone)
       VALUES ($1, 'LIBRARY', 'Test street', 'Asia/Phnom_Penh') RETURNING id`,
      [`it-${run}`],
    );
    await ds.query(
      `INSERT INTO booking_policies (place_id, max_active_per_user) VALUES ($1, 50)`,
      [placeId],
    );
    const seats: { id: string }[] = await ds.query(
      `INSERT INTO seats (place_id, label) VALUES ($1, 'S1'), ($1, 'S2'), ($1, 'S3') RETURNING id`,
      [placeId],
    );
    [s1, s2, s3] = seats.map((s) => s.id);
  });

  afterAll(async () => {
    // Remove only what this run created.
    if (ds?.isInitialized) {
      await ds.query(
        `DELETE FROM outbox_events WHERE aggregate_id IN (SELECT id FROM bookings WHERE user_id = ANY($1))`,
        [userIds],
      );
      await ds.query('DELETE FROM bookings WHERE user_id = ANY($1)', [userIds]);
      await ds.query('DELETE FROM notifications WHERE user_id = ANY($1)', [userIds]);
      await ds.query('DELETE FROM telegram_accounts WHERE user_id = ANY($1)', [userIds]);
      await ds.query('DELETE FROM seats WHERE place_id = $1', [placeId]);
      await ds.query('DELETE FROM booking_policies WHERE place_id = $1', [placeId]);
      await ds.query('DELETE FROM places WHERE id = $1', [placeId]);
      await ds.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    }
    await moduleRef?.close();
  });

  describe('no double-booking (exclusion constraint)', () => {
    it('lets exactly one of 20 concurrent bookings of the same seat and time succeed', async () => {
      const users = await Promise.all(Array.from({ length: 20 }, () => newUser()));
      const results = await Promise.allSettled(users.map((u) => book(u, [s1], day)));

      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(failed).toHaveLength(19);
      for (const f of failed) expect(f.reason).toBeInstanceOf(ConflictException);
    });

    it('rejects overlapping concurrent modifications: exactly one wins', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const ga = await book(a, [s2], plus(day, 8 * 60));
      const gb = await book(b, [s2], plus(day, 10 * 60));
      const target = { startAt: iso(plus(day, 12 * 60)), endAt: iso(plus(day, 13 * 60)) };

      const results = await Promise.allSettled([
        bookings.modify(a, ga.bookings[0].id, target, 'booking'),
        bookings.modify(b, gb.bookings[0].id, target, 'booking'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects an extend and a modify racing for the same slot: exactly one wins', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const ga = await book(a, [s3], plus(day, 14 * 60));
      const gb = await book(b, [s3], plus(day, 17 * 60));

      const results = await Promise.allSettled([
        bookings.extend(a, ga.bookings[0].id, { endAt: iso(plus(day, 16 * 60)) }, 'booking'),
        bookings.modify(
          b,
          gb.bookings[0].id,
          { startAt: iso(plus(day, 15 * 60)), endAt: iso(plus(day, 16 * 60)) },
          'booking',
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('multi-seat booking', () => {
    it('books several seats as one group with alerts and outbox rows', async () => {
      const u = await newUser();
      const group = await book(u, [s1, s2], plus(day, 2 * 60));
      const ids = group.bookings.map((b) => b.id);

      expect(group.bookings).toHaveLength(2);
      expect(new Set(group.bookings.map((b) => b.groupId))).toEqual(new Set([group.groupId]));
      expect(group.bookings.map((b) => b.seat.label).sort()).toEqual(['S1', 'S2']);

      const alerts: { type: string }[] = await ds.query(
        'SELECT type FROM notifications WHERE booking_id = ANY($1)',
        [ids],
      );
      expect(alerts.map((a) => a.type).sort()).toEqual(
        ['BOOKING_CONFIRMED', 'BOOKING_CONFIRMED', 'CHECKOUT_REMINDER', 'CHECKOUT_REMINDER', 'LATE_CHECKIN', 'LATE_CHECKIN'],
      );
      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = ANY($1) AND event_type = 'booking.created'`,
        [ids],
      );
      expect(count).toBe(2);
    });

    it('is all-or-nothing: one taken seat means nothing is booked', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const start = plus(day, 3 * 60);
      await book(a, [s1], start);

      await expect(book(b, [s3, s1], start)).rejects.toBeInstanceOf(ConflictException);
      const rows = await ds.query('SELECT id FROM bookings WHERE user_id = $1', [b.id]);
      expect(rows).toHaveLength(0);
    });

    it('rejects listing the same seat twice', async () => {
      const u = await newUser();
      await expect(book(u, [s1, s1], plus(day, 4 * 60))).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('idempotency', () => {
    it('returns the same booking for a repeated Idempotency-Key', async () => {
      const u = await newUser();
      const key = `key-${run}`;
      const first = await book(u, [s3], plus(day, 5 * 60), 60, key);
      const again = await book(u, [s3], plus(day, 5 * 60), 60, key);
      expect(again.groupId).toBe(first.groupId);

      const concurrent = await Promise.all(
        Array.from({ length: 5 }, () => book(u, [s3], plus(day, 5 * 60), 60, key)),
      );
      expect(new Set(concurrent.map((g) => g.groupId))).toEqual(new Set([first.groupId]));
      const rows = await ds.query('SELECT id FROM bookings WHERE user_id = $1', [u.id]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('cancel and ownership', () => {
    it('makes a cancelled slot bookable again and skips pending alerts', async () => {
      const [a, b] = [await newUser(), await newUser()];
      const start = plus(day, 6 * 60);
      const g = await book(a, [s1], start);
      const id = g.bookings[0].id;

      const cancelled = await bookings.cancel(a, id, { reason: 'plans changed' }, 'booking');
      expect(cancelled.bookings[0].status).toBe(BookingStatus.CANCELLED);
      await expect(book(b, [s1], start)).resolves.toBeDefined();

      const alerts: { type: string; status: string }[] = await ds.query(
        'SELECT type, status FROM notifications WHERE booking_id = $1',
        [id],
      );
      expect(alerts.find((x) => x.type === 'LATE_CHECKIN')?.status).toBe('SKIPPED');
      expect(alerts.find((x) => x.type === 'BOOKING_CANCELLED')?.status).toBe('PENDING');
    });

    it("hides other users' bookings (404)", async () => {
      const [a, b] = [await newUser(), await newUser()];
      const g = await book(a, [s2], plus(day, 7 * 60));
      const id = g.bookings[0].id;
      await expect(bookings.getMine(b, id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(bookings.cancel(b, id, {}, 'booking')).rejects.toBeInstanceOf(NotFoundException);
      await expect(qr.issue(b, id, QrPurpose.CHECK_IN, 'GROUP')).rejects.toBeInstanceOf(NotFoundException);
      expect(await statusOf(id)).toBe(BookingStatus.PENDING);
    });
  });

  describe('one-time QR check-in / check-out', () => {
    it('rejects a check-in outside the window', async () => {
      const u = await newUser();
      const g = await book(u, [s3], plus(day, 18 * 60));
      const issued = await qr.issue(u, g.bookings[0].id, QrPurpose.CHECK_IN, 'GROUP');
      await expect(attendance.scan(u, issued.codes[0].payload, QrPurpose.CHECK_IN)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('supports GROUP and EACH codes, single use, revoked on reissue', async () => {
      const u = await newUser();
      const other = await newUser();
      const soon = ceilSlot(plus(new Date(), 1));
      const g = await book(u, [s1, s2], soon, 30);
      const firstId = g.bookings[0].id;

      const each = await qr.issue(u, firstId, QrPurpose.CHECK_IN, 'EACH');
      expect(each.codes).toHaveLength(2);
      expect(each.codes[0].imageDataUrl).toMatch(/^data:image\/png;base64,/);

      const group = await qr.issue(u, firstId, QrPurpose.CHECK_IN, 'GROUP');
      expect(group.codes).toHaveLength(1);
      expect(group.codes[0].bookingIds).toHaveLength(2);

      // Reissuing revoked the per-seat codes.
      await expect(attendance.scan(u, each.codes[0].payload, QrPurpose.CHECK_IN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // Someone else's QR (non-staff) is refused and the token is not consumed.
      await expect(attendance.scan(other, group.codes[0].payload, QrPurpose.CHECK_IN)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      const result = await attendance.scan(u, group.codes[0].payload, QrPurpose.CHECK_IN);
      expect(result.bookings.map((b) => b.status)).toEqual([BookingStatus.CHECKED_IN, BookingStatus.CHECKED_IN]);
      await expect(attendance.scan(u, group.codes[0].payload, QrPurpose.CHECK_IN)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const late: { status: string }[] = await ds.query(
        `SELECT status FROM notifications WHERE booking_id = ANY($1) AND type = 'LATE_CHECKIN'`,
        [g.bookings.map((b) => b.id)],
      );
      expect(late.map((n) => n.status)).toEqual(['SKIPPED', 'SKIPPED']);

      const out = await qr.issue(u, firstId, QrPurpose.CHECK_OUT, 'EACH');
      const done = await attendance.scan(u, out.codes[0].payload, QrPurpose.CHECK_OUT);
      expect(done.bookings).toHaveLength(1);
      expect(done.bookings[0].status).toBe(BookingStatus.COMPLETED);
      const remaining = g.bookings.map((b) => b.id).find((id) => id !== done.bookings[0].id)!;
      expect(await statusOf(remaining)).toBe(BookingStatus.CHECKED_IN);
    });
  });

  describe('notification dispatch (Telegram strategy, bot mocked)', () => {
    const drain = async () => {
      for (let i = 0; i < 20; i++) {
        const s = await dispatcher.dispatchDue(new Date());
        if (s.sent + s.skipped + s.retrying + s.failed === 0) return;
      }
    };

    it('sends ONE Telegram message per multi-seat booking, skips users without Telegram', async () => {
      await drain();
      sendMessage.mockClear();
      const linked = await newUser();
      const unlinked = await newUser();
      await ds.query(`INSERT INTO telegram_accounts (user_id, chat_id) VALUES ($1, $2)`, [linked.id, '900100']);

      const g = await book(linked, [s1, s2], plus(day, 20 * 60));
      const lone = await book(unlinked, [s3], plus(day, 20 * 60));
      await drain();

      const toChat = sendMessage.mock.calls.filter(([chatId]) => chatId === '900100');
      expect(toChat).toHaveLength(1);
      expect(toChat[0][1]).toContain('Booking confirmed');
      expect(toChat[0][1]).toContain('seats S1, S2');

      const sent: { status: string }[] = await ds.query(
        `SELECT status FROM notifications WHERE booking_id = ANY($1) AND type = 'BOOKING_CONFIRMED'`,
        [g.bookings.map((b) => b.id)],
      );
      expect(sent.map((n) => n.status)).toEqual(['SENT', 'SENT']);
      const [skipped] = await ds.query(
        `SELECT status FROM notifications WHERE booking_id = $1 AND type = 'BOOKING_CONFIRMED'`,
        [lone.bookings[0].id],
      );
      expect(skipped.status).toBe('SKIPPED');
    });
  });

  // Last: these drive the clock forward, which affects every booking in the test DB.
  describe('scheduled jobs', () => {
    it('expires a no-show at start + grace, counts it once per group, frees the seats', async () => {
      const [u, other] = [await newUser(), await newUser()];
      const start = plus(day, 3 * 24 * 60);
      const g = await book(u, [s1, s2], start);
      const ids = g.bookings.map((b) => b.id);

      await lifecycle.expireDue(plus(start, 14));
      expect(await statusOf(ids[0])).toBe(BookingStatus.PENDING);

      await lifecycle.expireDue(plus(start, 16));
      expect(await statusOf(ids[0])).toBe(BookingStatus.EXPIRED);
      expect(await statusOf(ids[1])).toBe(BookingStatus.EXPIRED);

      const [{ no_show_count }] = await ds.query('SELECT no_show_count FROM users WHERE id = $1', [u.id]);
      expect(no_show_count).toBe(1);

      const alerts: { type: string; status: string }[] = await ds.query(
        'SELECT type, status FROM notifications WHERE booking_id = $1',
        [ids[0]],
      );
      expect(alerts.find((a) => a.type === 'BOOKING_EXPIRED')?.status).toBe('PENDING');
      expect(alerts.find((a) => a.type === 'LATE_CHECKIN')?.status).toBe('SKIPPED');

      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = ANY($1) AND event_type = 'booking.expired'`,
        [ids],
      );
      expect(count).toBe(2);
      await expect(book(other, [s1], start)).resolves.toBeDefined();
    });

    it('marks a forgotten checkout CHECKOUT_OVERDUE at end + overdue_alert_minutes', async () => {
      const [u, other] = [await newUser(), await newUser()];
      const admin = await newUser(UserRole.ADMIN);
      const start = ceilSlot(plus(new Date(), 1));
      const end = plus(start, 30);
      const g = await book(u, [s3], start, 30);
      const id = g.bookings[0].id;
      await attendance.manualCheckIn(admin, id);

      await lifecycle.markOverdue(plus(end, 14));
      expect(await statusOf(id)).toBe(BookingStatus.CHECKED_IN);

      await lifecycle.markOverdue(plus(end, 15));
      expect(await statusOf(id)).toBe(BookingStatus.CHECKOUT_OVERDUE);
      const [forgotten] = await ds.query(
        `SELECT status FROM notifications WHERE booking_id = $1 AND type = 'FORGOTTEN_CHECKOUT'`,
        [id],
      );
      expect(forgotten.status).toBe('PENDING');

      // The range has ended, so the next slot can be booked...
      await expect(book(other, [s3], end, 30)).resolves.toBeDefined();
      // ...and the user can still check out late with a QR.
      const out = await qr.issue(u, id, QrPurpose.CHECK_OUT, 'GROUP');
      const done = await attendance.scan(u, out.codes[0].payload, QrPurpose.CHECK_OUT);
      expect(done.bookings[0].status).toBe(BookingStatus.COMPLETED);
    });
  });
});

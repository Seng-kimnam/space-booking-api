import {
  ConflictException,
  INestApplication,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AttendanceService } from '../../../src/bookings/services/attendance.service';
import { BookingLifecycleService } from '../../../src/bookings/services/booking-lifecycle.service';
import { BookingsService } from '../../../src/bookings/services/bookings.service';
import { BookingStatus, SeatStatus, UserRole } from '../../../src/common/enums';
import type { AuthUser } from '../../../src/common/types/auth-user';
import { PlacesService } from '../../../src/places/services/places.service';
import { SeatsService } from '../../../src/seats/services/seats.service';
import { createTestApp } from '../../utils/create-test-app';

/**
 * docs/improvement-plan.md, items 1-5, 9, 10 and 12, against the full app
 * (AppModule, real ports and opening hours) and a REAL Postgres. Jobs are
 * driven with a fake `now`, so this must run on a *_test database.
 */
const HOUR = 60;
const plus = (d: Date, minutes: number) =>
  new Date(d.getTime() + minutes * 60_000);
const iso = (d: Date) => d.toISOString();

describe('Improvement plan (e2e, real Postgres)', () => {
  const run = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const placeIds: string[] = [];
  let app: INestApplication;
  let ds: DataSource;
  let bookings: BookingsService;
  let lifecycle: BookingLifecycleService;
  let seats: SeatsService;
  let places: PlacesService;
  let attendance: AttendanceService;
  // Two days ahead at 10:00 UTC: well inside max_advance_days, and the
  // place is in UTC so slots and closures are easy to reason about.
  const day = new Date(Date.now() + 2 * 24 * 3_600_000);
  day.setUTCHours(10, 0, 0, 0);
  const dayDate = iso(day).slice(0, 10);

  let userSeq = 0;
  async function newUser(role: UserRole = UserRole.USER): Promise<AuthUser> {
    const n = userSeq++;
    // CHK_users_has_credential requires a password_hash or a google_id.
    const [{ id }] = await ds.query(
      `INSERT INTO users (name, email, role_id, password_hash)
       VALUES ($1, $2, (SELECT id FROM roles WHERE name = $3), 'test-hash') RETURNING id`,
      ['Test', `ip-${run}-${n}@example.test`, role],
    );
    userIds.push(id);
    return { id, role };
  }

  /** An active place, open 24/7, with `seatCount` seats. */
  async function newPlace(
    seatCount = 2,
    maxActive = 50,
  ): Promise<{ placeId: string; seatIds: string[] }> {
    const [{ id: placeId }] = await ds.query(
      `INSERT INTO places (name, type, address, timezone)
       VALUES ($1, 'LIBRARY', 'Test street', 'UTC') RETURNING id`,
      [`ip-${run}-${placeIds.length}`],
    );
    placeIds.push(placeId);
    await ds.query(
      `INSERT INTO booking_policies (place_id, max_active_per_user) VALUES ($1, $2)`,
      [placeId, maxActive],
    );
    for (let weekday = 0; weekday < 7; weekday++)
      await ds.query(
        `INSERT INTO place_opening_hours (place_id, weekday, open_time, close_time, closes_next_day)
         VALUES ($1, $2, '00:00', '00:00', true)`,
        [placeId, weekday],
      );
    const seatIds: string[] = [];
    for (let i = 0; i < seatCount; i++) {
      const [{ id }] = await ds.query(
        `INSERT INTO seats (place_id, label) VALUES ($1, $2) RETURNING id`,
        [placeId, `S${i + 1}`],
      );
      seatIds.push(id);
    }
    return { placeId, seatIds };
  }

  const book = (
    user: AuthUser,
    seatIds: string[],
    start: Date,
    minutes = HOUR,
    key?: string,
  ) =>
    bookings.create(
      user,
      { seatIds, startAt: iso(start), endAt: iso(plus(start, minutes)) },
      key,
    );

  const statusOf = async (id: string) =>
    (await ds.query('SELECT status FROM bookings WHERE id = $1', [id]))[0]
      .status as BookingStatus;

  const noShows = async (userId: string) =>
    (
      await ds.query('SELECT no_show_count FROM users WHERE id = $1', [userId])
    )[0].no_show_count as number;

  /** Runs the expire job at `now` until it has nothing left. */
  async function expireAt(now: Date) {
    while ((await lifecycle.expireDue(now)) > 0);
  }

  /** The cancellation an admin change must leave behind (AGENTS.md section 6.11). */
  async function expectAdminCancelled(bookingId: string, subReason: string) {
    expect(await statusOf(bookingId)).toBe(BookingStatus.CANCELLED);
    const [event] = await ds.query(
      `SELECT metadata FROM booking_events WHERE booking_id = $1 AND type = 'CANCELLED'`,
      [bookingId],
    );
    expect(event.metadata.subReason).toBe(subReason);
    const [alert] = await ds.query(
      `SELECT status FROM notifications WHERE booking_id = $1 AND type = 'BOOKING_CANCELLED'`,
      [bookingId],
    );
    expect(alert.status).toBe('PENDING');
    const [outbox] = await ds.query(
      `SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'booking.cancelled'`,
      [bookingId],
    );
    expect(outbox.payload.cancelReason).toBe('ADMIN_CANCELLED');
  }

  beforeAll(async () => {
    if (!process.env.DB_NAME?.endsWith('_test')) {
      throw new Error(
        'Run against a dedicated *_test database: DB_NAME=..._test npm run test:e2e',
      );
    }
    app = await createTestApp();
    ds = app.get(DataSource);
    bookings = app.get(BookingsService);
    lifecycle = app.get(BookingLifecycleService);
    seats = app.get(SeatsService);
    places = app.get(PlacesService);
    attendance = app.get(AttendanceService);
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(
        `DELETE FROM outbox_events WHERE aggregate_id IN (SELECT id FROM bookings WHERE user_id = ANY($1))`,
        [userIds],
      );
      await ds.query('DELETE FROM bookings WHERE user_id = ANY($1)', [userIds]);
      await ds.query('DELETE FROM notifications WHERE user_id = ANY($1)', [
        userIds,
      ]);
      await ds.query('DELETE FROM seats WHERE place_id = ANY($1)', [placeIds]);
      await ds.query('DELETE FROM places WHERE id = ANY($1)', [placeIds]);
      await ds.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    }
    await app?.close();
  });

  describe('1. admin changes cancel stranded bookings (no unearned no-show)', () => {
    it('seat MAINTENANCE cancels its PENDING bookings; the expire job leaves them alone', async () => {
      const { seatIds } = await newPlace();
      const user = await newUser();
      const {
        bookings: [b],
      } = await book(user, [seatIds[0]], day);
      const {
        bookings: [other],
      } = await book(user, [seatIds[1]], day);

      await seats.setStatus(seatIds[0], SeatStatus.MAINTENANCE);

      await expectAdminCancelled(b.id, 'SEAT_UNAVAILABLE');
      expect(await statusOf(other.id)).toBe(BookingStatus.PENDING);
      await expireAt(plus(day, 16));
      expect(await statusOf(b.id)).toBe(BookingStatus.CANCELLED);
      // Only the untouched seat's booking counted as a no-show.
      expect(await noShows(user.id)).toBe(1);
    });

    it('seat delete cancels its PENDING bookings', async () => {
      const { seatIds } = await newPlace();
      const user = await newUser();
      const {
        bookings: [b],
      } = await book(user, [seatIds[0]], day);
      await seats.softDelete(seatIds[0]);
      await expectAdminCancelled(b.id, 'SEAT_DELETED');
    });

    it('a closure on the booking date cancels only the bookings on that date', async () => {
      const { placeId, seatIds } = await newPlace();
      const user = await newUser();
      const {
        bookings: [hit],
      } = await book(user, [seatIds[0]], day);
      const {
        bookings: [miss],
      } = await book(user, [seatIds[0]], plus(day, 24 * HOUR));
      await places.update(placeId, {
        closures: [{ date: dayDate, reason: 'Holiday' }],
      });
      await expectAdminCancelled(hit.id, 'HOURS_CHANGED');
      expect(await statusOf(miss.id)).toBe(BookingStatus.PENDING);
    });

    it('deactivating a place cancels its PENDING bookings', async () => {
      const { placeId, seatIds } = await newPlace();
      const user = await newUser();
      const {
        bookings: [b],
      } = await book(user, [seatIds[0]], day);
      await places.update(placeId, { isActive: false });
      await expectAdminCancelled(b.id, 'PLACE_DEACTIVATED');
    });

    it('deleting a place cancels its PENDING bookings', async () => {
      const { placeId, seatIds } = await newPlace();
      const user = await newUser();
      const {
        bookings: [b],
      } = await book(user, [seatIds[0]], day);
      await places.softDelete(placeId);
      await expectAdminCancelled(b.id, 'PLACE_DELETED');
    });
  });

  describe('2. checkout reminder after extend / modify', () => {
    it('extend after the reminder was sent queues a new one at the new end - N', async () => {
      const { seatIds } = await newPlace();
      const user = await newUser();
      const {
        bookings: [b],
      } = await book(user, [seatIds[0]], day);
      // As if the dispatcher had already sent the 10:45 reminder.
      await ds.query(
        `UPDATE notifications SET status = 'SENT', sent_at = now()
          WHERE booking_id = $1 AND type = 'CHECKOUT_REMINDER'`,
        [b.id],
      );
      await bookings.extend(
        user,
        b.id,
        { endAt: iso(plus(day, 2 * HOUR)) },
        'booking',
      );
      const [reminder] = await ds.query(
        `SELECT status, scheduled_at, sent_at, payload FROM notifications
          WHERE booking_id = $1 AND type = 'CHECKOUT_REMINDER'`,
        [b.id],
      );
      expect(reminder.status).toBe('PENDING');
      expect(reminder.sent_at).toBeNull();
      expect(new Date(reminder.scheduled_at)).toEqual(plus(day, 2 * HOUR - 15));
      expect(reminder.payload.endAt).toBe(iso(plus(day, 2 * HOUR)));
    });

    it('a booking too short for a reminder gets one once extended', async () => {
      const { placeId, seatIds } = await newPlace();
      await ds.query(
        `UPDATE booking_policies SET checkout_reminder_minutes = 60 WHERE place_id = $1`,
        [placeId],
      );
      const user = await newUser();
      const {
        bookings: [b],
      } = await book(user, [seatIds[0]], day);
      const none = await ds.query(
        `SELECT 1 FROM notifications WHERE booking_id = $1 AND type = 'CHECKOUT_REMINDER'`,
        [b.id],
      );
      expect(none).toHaveLength(0);
      await bookings.extend(
        user,
        b.id,
        { endAt: iso(plus(day, 2 * HOUR)) },
        'booking',
      );
      const [reminder] = await ds.query(
        `SELECT status, scheduled_at FROM notifications WHERE booking_id = $1 AND type = 'CHECKOUT_REMINDER'`,
        [b.id],
      );
      expect(reminder.status).toBe('PENDING');
      expect(new Date(reminder.scheduled_at)).toEqual(plus(day, HOUR));
    });
  });

  describe('3. max_active_per_user is per place', () => {
    it('a user at the limit at place A can still book at place B', async () => {
      const a = await newPlace(2, 1);
      const b = await newPlace(1, 1);
      const user = await newUser();
      await book(user, [a.seatIds[0]], day);
      await expect(
        book(user, [a.seatIds[1]], plus(day, 2 * HOUR)),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(book(user, [b.seatIds[0]], day)).resolves.toBeDefined();
    });
  });

  describe('4. one no-show per multi-seat booking, across job runs', () => {
    it('a group whose seats expire in different runs counts once', async () => {
      const { seatIds } = await newPlace();
      const user = await newUser();
      const group = await book(user, seatIds, day);
      const [first, second] = group.bookings;
      // Per-seat modify: the second seat now starts two hours later.
      await bookings.modify(
        user,
        second.id,
        { startAt: iso(plus(day, 2 * HOUR)), endAt: iso(plus(day, 3 * HOUR)) },
        'booking',
      );

      await expireAt(plus(day, 16));
      expect(await statusOf(first.id)).toBe(BookingStatus.EXPIRED);
      expect(await statusOf(second.id)).toBe(BookingStatus.PENDING);
      expect(await noShows(user.id)).toBe(1);

      await expireAt(plus(day, 2 * HOUR + 16));
      expect(await statusOf(second.id)).toBe(BookingStatus.EXPIRED);
      expect(await noShows(user.id)).toBe(1);
    });
  });

  describe('5. modify / extend re-check that the seat is bookable', () => {
    it('409 on a seat put in maintenance (set directly, bypassing the admin cancel)', async () => {
      const { seatIds } = await newPlace();
      const user = await newUser();
      const {
        bookings: [b],
      } = await book(user, [seatIds[0]], day);
      await ds.query(`UPDATE seats SET status = 'MAINTENANCE' WHERE id = $1`, [
        seatIds[0],
      ]);
      await expect(
        bookings.modify(
          user,
          b.id,
          { startAt: iso(plus(day, HOUR)), endAt: iso(plus(day, 2 * HOUR)) },
          'booking',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        bookings.extend(
          user,
          b.id,
          { endAt: iso(plus(day, 2 * HOUR)) },
          'booking',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await statusOf(b.id)).toBe(BookingStatus.PENDING);
    });
  });

  describe('12. Idempotency-Key reused with a different body', () => {
    it('same body returns the same booking; a different body is 422', async () => {
      const { seatIds } = await newPlace();
      const user = await newUser();
      const key = `k-${run}`;
      const first = await book(user, [seatIds[0]], day, HOUR, key);
      const again = await book(user, [seatIds[0]], day, HOUR, key);
      expect(again.groupId).toBe(first.groupId);
      await expect(
        book(user, [seatIds[0]], day, 2 * HOUR, key),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        book(user, [seatIds[1]], day, HOUR, key),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('10. SUPER_ADMIN is staff at attendance', () => {
    it("sees another user's check-in status", async () => {
      const { seatIds } = await newPlace();
      const user = await newUser();
      const superAdmin = await newUser(UserRole.SUPER_ADMIN);
      const {
        bookings: [b],
      } = await book(user, [seatIds[0]], day);
      await expect(
        attendance.getCheckInStatus(superAdmin, b.id),
      ).resolves.toBeDefined();
    });
  });

  describe('9. availability endpoints', () => {
    const http = () => request(app.getHttpServer());

    it('GET /seats/available lists only seats free for the whole window', async () => {
      const { placeId, seatIds } = await newPlace(3);
      const user = await newUser();
      await book(user, [seatIds[0]], day);
      const res = await http()
        .get('/api/v1/seats/available')
        .query({
          placeId,
          startAt: iso(plus(day, 30)),
          endAt: iso(plus(day, 90)),
        });
      expect(res.status).toBe(200);
      expect(res.body.placeOpen).toBe(true);
      expect(res.body.total).toBe(2);
      expect(res.body.items.map((s: { id: string }) => s.id).sort()).toEqual(
        [seatIds[1], seatIds[2]].sort(),
      );
    });

    it('GET /seats/available is empty with placeOpen=false on a closure day', async () => {
      const { placeId } = await newPlace(1);
      await ds.query(
        `INSERT INTO place_closures (place_id, date) VALUES ($1, $2)`,
        [placeId, dayDate],
      );
      const res = await http()
        .get('/api/v1/seats/available')
        .query({ placeId, startAt: iso(day), endAt: iso(plus(day, HOUR)) });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ items: [], total: 0, placeOpen: false });
    });

    it('GET /seats/available validates the window and the place', async () => {
      const { placeId } = await newPlace(1);
      const bad = await http()
        .get('/api/v1/seats/available')
        .query({ placeId, startAt: iso(plus(day, HOUR)), endAt: iso(day) });
      expect(bad.status).toBe(400);
      const missing = await http()
        .get('/api/v1/seats/available')
        .query({
          placeId: randomUUID(),
          startAt: iso(day),
          endAt: iso(plus(day, HOUR)),
        });
      expect(missing.status).toBe(404);
    });

    it('GET /seats/:seatId/availability shows booked ranges without ids', async () => {
      const { seatIds } = await newPlace(1);
      const user = await newUser();
      await book(user, [seatIds[0]], day);
      const res = await http()
        .get(`/api/v1/seats/${seatIds[0]}/availability`)
        .query({
          startAt: iso(plus(day, -HOUR)),
          endAt: iso(plus(day, 3 * HOUR)),
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        seatId: seatIds[0],
        available: false,
        bookable: true,
        placeOpen: true,
        busy: [{ startAt: iso(day), endAt: iso(plus(day, HOUR)) }],
      });
      expect(JSON.stringify(res.body)).not.toContain(user.id);

      const free = await http()
        .get(`/api/v1/seats/${seatIds[0]}/availability`)
        .query({
          startAt: iso(plus(day, HOUR)),
          endAt: iso(plus(day, 2 * HOUR)),
        });
      expect(free.body).toMatchObject({ available: true, busy: [] });
    });

    it('GET /seats/:seatId/availability 404s for an unknown seat', async () => {
      const res = await http()
        .get(`/api/v1/seats/${randomUUID()}/availability`)
        .query({ startAt: iso(day), endAt: iso(plus(day, HOUR)) });
      expect(res.status).toBe(404);
    });
  });
});

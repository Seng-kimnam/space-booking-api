import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { signToken } from '../../utils/auth-tokens';
import { deleteRows } from '../../utils/fixtures';

describe('places admin writes (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let user: string;
  const placeIds: string[] = [];
  const seatIds: string[] = [];

  const api = (
    m: 'post' | 'patch' | 'delete' | 'get',
    url: string,
    token?: string,
  ) => {
    const r = request(app.getHttpServer())[m](`/api/v1${url}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const name = () => `adm-${randomUUID().slice(0, 8)}`;
  const create = async (body: object = {}) => {
    const res = await api('post', '/admin/places', admin).send({
      name: name(),
      type: 'LIBRARY',
      address: 'Street 1',
      ...body,
    });
    if (res.body.id) placeIds.push(res.body.id);
    return res;
  };
  const patch = (id: string, body: object) =>
    api('patch', `/admin/places/${id}`, admin).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    admin = await signToken(app, 'ADMIN');
    user = await signToken(app, 'USER');
  });

  afterAll(async () => {
    await deleteRows(ds, 'seats', seatIds);
    await deleteRows(ds, 'places', placeIds);
    await app.close();
  });

  describe('authentication and authorization', () => {
    const id = randomUUID();
    const routes: Array<['post' | 'patch' | 'delete', string, object?]> = [
      ['post', '/admin/places', { name: 'x', type: 'CAFE', address: 'y' }],
      ['patch', `/admin/places/${id}`, { name: 'x' }],
      ['delete', `/admin/places/${id}`, undefined],
    ];
    it.each(routes)(
      '%s %s: 401 without/invalid token, 403 for USER',
      async (m, url, body) => {
        for (const token of [undefined, 'garbage'])
          expect((await api(m, url, token).send(body)).status).toBe(401);
        expect((await api(m, url, user).send(body)).status).toBe(403);
      },
    );
  });

  describe('POST /admin/places', () => {
    it('201 with defaults: active, Phnom Penh timezone, default policy, no hours', async () => {
      const res = await create({ name: '  Trimmed Name  ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Trimmed Name',
        type: 'LIBRARY',
        description: null,
        lat: null,
        lng: null,
        timezone: 'Asia/Phnom_Penh',
        isActive: true,
        openingHours: [],
        closures: [],
        bookingPolicy: {
          checkinGraceMinutes: 15,
          checkoutReminderMinutes: 15,
          overdueAlertMinutes: 15,
          minMinutes: 30,
          maxMinutes: 240,
          slotMinutes: 15,
          maxAdvanceDays: 7,
          maxActivePerUser: 1,
          maxExtensions: 2,
          modifyCutoffMinutes: 30,
        },
      });
      expect((await api('get', `/places/${res.body.id}`)).status).toBe(200);
    });

    it('201 with hours, closures, policy and a canonicalised timezone', async () => {
      const res = await create({
        type: 'COWORKING',
        description: 'desc',
        lat: 11.56,
        lng: 104.92,
        timezone: 'asia/bangkok',
        openingHours: [
          {
            weekday: 5,
            openTime: '18:00',
            closeTime: '02:00',
            closesNextDay: true,
          },
          { weekday: 1, openTime: '07:00', closeTime: '21:30:00' },
        ],
        closures: [{ date: '2999-01-01', reason: ' New year ' }],
        bookingPolicy: { checkinGraceMinutes: 5, maxMinutes: 120 },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        timezone: 'Asia/Bangkok',
        lat: 11.56,
        lng: 104.92,
        openingHours: [
          {
            weekday: 1,
            openTime: '07:00:00',
            closeTime: '21:30:00',
            closesNextDay: false,
          },
          {
            weekday: 5,
            openTime: '18:00:00',
            closeTime: '02:00:00',
            closesNextDay: true,
          },
        ],
        closures: [{ date: '2999-01-01', reason: 'New year' }],
        bookingPolicy: {
          checkinGraceMinutes: 5,
          maxMinutes: 120,
          minMinutes: 30,
        },
      });
    });

    it('201 but hidden publicly when created inactive', async () => {
      const res = await create({ isActive: false });
      expect(res.status).toBe(201);
      expect(res.body.isActive).toBe(false);
      expect((await api('get', `/places/${res.body.id}`)).status).toBe(404);
    });

    it.each([
      ['missing name', { name: undefined }],
      ['unknown field', { bogus: 1 }],
      ['offset timezone', { timezone: '+07:00' }],
      [
        'bad close time',
        {
          openingHours: [{ weekday: 1, openTime: '10:00', closeTime: '09:00' }],
        },
      ],
      ['invalid closure date', { closures: [{ date: '2026-02-30' }] }],
    ])('400 for %s', async (_, body) => {
      expect((await create(body)).status).toBe(400);
    });

    it('400 when the policy ends up with maxMinutes < minMinutes, and creates nothing', async () => {
      const n = name();
      const res = await create({ name: n, bookingPolicy: { maxMinutes: 20 } });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('maxMinutes');
      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM places WHERE name = $1`,
        [n],
      );
      expect(count).toBe(0); // the place insert was rolled back with the policy
    });
  });

  describe('PATCH /admin/places/:placeId', () => {
    let P: string;
    beforeEach(async () => {
      P = (
        await create({
          description: 'keep me',
          lat: 1,
          openingHours: [{ weekday: 1, openTime: '07:00', closeTime: '21:00' }],
          closures: [{ date: '2999-01-01' }],
        })
      ).body.id;
    });

    it('changes only the fields sent', async () => {
      const res = await patch(P, { address: 'New address' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        address: 'New address',
        description: 'keep me',
        lat: 1,
        openingHours: [{ weekday: 1 }],
        closures: [{ date: '2999-01-01' }],
      });
    });

    it('clears nullable fields with null', async () => {
      const res = await patch(P, { description: null, lat: null });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ description: null, lat: null });
    });

    it('replaces the whole set of opening hours and closures', async () => {
      const res = await patch(P, {
        openingHours: [
          { weekday: 2, openTime: '08:00', closeTime: '12:00' },
          { weekday: 4, openTime: '13:00', closeTime: '17:00' },
        ],
        closures: [{ date: '2999-06-01' }, { date: '2999-06-02' }],
      });
      expect(res.status).toBe(200);
      expect(
        res.body.openingHours.map((h: { weekday: number }) => h.weekday),
      ).toEqual([2, 4]);
      expect(res.body.closures.map((c: { date: string }) => c.date)).toEqual([
        '2999-06-01',
        '2999-06-02',
      ]);
    });

    it('[] removes all hours and closures', async () => {
      const res = await patch(P, { openingHours: [], closures: [] });
      expect(res.body).toMatchObject({ openingHours: [], closures: [] });
    });

    it('merges the booking policy', async () => {
      await patch(P, { bookingPolicy: { checkinGraceMinutes: 3 } });
      const res = await patch(P, { bookingPolicy: { maxExtensions: 0 } });
      expect(res.body.bookingPolicy).toMatchObject({
        checkinGraceMinutes: 3,
        maxExtensions: 0,
        maxMinutes: 240,
      });
    });

    it('creates the policy row if a place has none', async () => {
      await ds.query(`DELETE FROM booking_policies WHERE place_id = $1`, [P]);
      const res = await patch(P, { bookingPolicy: { slotMinutes: 30 } });
      expect(res.status).toBe(200);
      expect(res.body.bookingPolicy).toMatchObject({
        slotMinutes: 30,
        minMinutes: 30,
      });
    });

    it('400 on an invalid merged policy and rolls back the other changes', async () => {
      const res = await patch(P, {
        name: 'should not stick',
        openingHours: [],
        bookingPolicy: { minMinutes: 300 },
      });
      expect(res.status).toBe(400);
      const after = await api('get', `/places/${P}`);
      expect(after.body.name).not.toBe('should not stick');
      expect(after.body.openingHours).toHaveLength(1);
      expect(after.body.bookingPolicy.minMinutes).toBe(30);
    });

    it('lets admins edit an inactive place, which stays hidden publicly', async () => {
      expect((await patch(P, { isActive: false })).status).toBe(200);
      expect((await api('get', `/places/${P}`)).status).toBe(404);
      const res = await patch(P, { name: 'still editable' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'still editable',
        isActive: false,
      });
    });

    it('404 for unknown and deleted places; 400 for a bad id or null name', async () => {
      expect((await patch(randomUUID(), { name: 'x' })).status).toBe(404);
      await api('delete', `/admin/places/${P}`, admin);
      expect((await patch(P, { name: 'x' })).status).toBe(404);
      expect((await patch('nope', { name: 'x' })).status).toBe(400);
      expect((await patch(randomUUID(), { name: null })).status).toBe(400);
    });

    it('serialises concurrent replacements: every request succeeds, one set wins whole', async () => {
      const sets = [0, 1, 2, 3, 4].map((i) => [
        { weekday: i, openTime: '08:00', closeTime: '12:00' },
        { weekday: i + 1, openTime: '13:00', closeTime: '17:00' },
      ]);
      const results = await Promise.all(
        sets.map((openingHours) => patch(P, { openingHours })),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);

      const rows: { weekday: number }[] = await ds.query(
        `SELECT weekday FROM place_opening_hours WHERE place_id = $1 ORDER BY weekday`,
        [P],
      );
      const final = rows.map((r) => r.weekday);
      expect(sets.map((s) => s.map((h) => h.weekday))).toContainEqual(final);
    });
  });

  describe('DELETE /admin/places/:placeId', () => {
    it('204, then hidden everywhere and a second delete 404s', async () => {
      const P = (await create()).body.id;
      const [{ id: seatId }] = await ds.query(
        `INSERT INTO seats (place_id, label) VALUES ($1, 'S1') RETURNING id`,
        [P],
      );
      seatIds.push(seatId);

      expect((await api('delete', `/admin/places/${P}`, admin)).status).toBe(
        204,
      );
      expect((await api('get', `/places/${P}`)).status).toBe(404);
      expect((await api('get', `/places/${P}/seats`)).status).toBe(404);
      expect((await api('get', `/seats/${seatId}`)).status).toBe(404);
      expect((await api('delete', `/admin/places/${P}`, admin)).status).toBe(
        404,
      );

      // Soft delete: the row and its policy are still there for history.
      const [row] = await ds.query(
        `SELECT deleted_at FROM places WHERE id = $1`,
        [P],
      );
      expect(row.deleted_at).not.toBeNull();
    });

    it('404 for an unknown place, 400 for a bad id', async () => {
      expect(
        (await api('delete', `/admin/places/${randomUUID()}`, admin)).status,
      ).toBe(404);
      expect((await api('delete', '/admin/places/nope', admin)).status).toBe(
        400,
      );
    });
  });
});

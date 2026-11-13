import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { signToken } from '../../utils/auth-tokens';
import { deleteRows, insertArea, insertPlace } from '../../utils/fixtures';

describe('seats admin writes (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let user: string;
  const placeIds: string[] = [];
  const areaIds: string[] = [];
  const seatIds: string[] = [];
  const userIds: string[] = [];
  const bookingIds: string[] = [];
  let P: string;
  let P2: string;
  let A: string;

  const api = (
    m: 'post' | 'patch' | 'delete' | 'get',
    url: string,
    token?: string,
  ) => {
    const r = request(app.getHttpServer())[m](`/api/v1${url}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const create = async (placeId: string, body: object) => {
    const res = await api('post', `/admin/places/${placeId}/seats`, admin).send(
      body,
    );
    if (res.body.id) seatIds.push(res.body.id);
    return res;
  };
  const lbl = () => `s-${randomUUID().slice(0, 8)}`;

  const insertUser = async () => {
    // CHK_users_has_credential requires a password_hash or a google_id.
    const [row] = await ds.query(
      `INSERT INTO users (name, email, role_id, password_hash)
       VALUES ($1, $2, (SELECT id FROM roles WHERE name = $3), 'test-hash') RETURNING id`,
      ['Seat test', `seat-${randomUUID()}@example.test`, 'USER'],
    );
    userIds.push(row.id);
    return row.id as string;
  };

  // One booking tomorrow, +1d .. +1d+1h. The timestamps the bookings_* CHECK
  // constraints require depend on the status (docs/schema/db.sql).
  const insertBooking = async (
    seatId: string,
    userId: string,
    status: string,
  ) => {
    const range = `tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour', '[)')`;
    let sql: string;
    const params: unknown[] = [seatId, userId, status];
    switch (status) {
      case 'CHECKED_IN':
      case 'CHECKOUT_OVERDUE':
        sql = `INSERT INTO bookings (seat_id, user_id, status, time_range, checked_in_at, check_in_method)
               VALUES ($1, $2, $3::booking_status, ${range}, now(), 'MANUAL') RETURNING id`;
        break;
      case 'COMPLETED':
        sql = `INSERT INTO bookings (seat_id, user_id, status, time_range, checked_in_at, check_in_method, checked_out_at, check_out_method)
               VALUES ($1, $2, $3::booking_status, ${range}, now() - interval '1 hour', 'MANUAL', now(), 'MANUAL') RETURNING id`;
        break;
      case 'CANCELLED':
        sql = `INSERT INTO bookings (seat_id, user_id, status, time_range, cancelled_at)
               VALUES ($1, $2, $3::booking_status, ${range}, now()) RETURNING id`;
        break;
      case 'EXPIRED':
        sql = `INSERT INTO bookings (seat_id, user_id, status, time_range, expired_at)
               VALUES ($1, $2, $3::booking_status, ${range}, now()) RETURNING id`;
        break;
      default: // PENDING: no extra timestamps
        sql = `INSERT INTO bookings (seat_id, user_id, status, time_range)
               VALUES ($1, $2, $3::booking_status, ${range}) RETURNING id`;
        break;
    }
    const [row] = await ds.query(sql, params);
    bookingIds.push(row.id);
    return row.id as string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    admin = await signToken(app, 'ADMIN');
    user = await signToken(app, 'USER');
    P = await insertPlace(ds);
    P2 = await insertPlace(ds);
    placeIds.push(P, P2);
    A = await insertArea(ds, P);
    areaIds.push(A);
  });

  afterAll(async () => {
    await deleteRows(ds, 'bookings', bookingIds);
    await deleteRows(ds, 'users', userIds);
    await deleteRows(ds, 'seats', seatIds);
    await deleteRows(ds, 'areas', areaIds);
    await deleteRows(ds, 'places', placeIds);
    await app.close();
  });

  describe('authentication and authorization', () => {
    const id = randomUUID();
    const routes: Array<['post' | 'patch' | 'delete', () => string, object?]> =
      [
        ['post', () => `/admin/places/${P}/seats`, { label: 'x' }],
        ['patch', () => `/admin/seats/${id}`, { label: 'x' }],
        ['patch', () => `/admin/seats/${id}/status`, { status: 'ACTIVE' }],
        ['delete', () => `/admin/seats/${id}`, undefined],
      ];
    it.each(routes)(
      '%s: 401 without/invalid token, 403 for USER',
      async (m, url, body) => {
        for (const token of [undefined, 'garbage']) {
          const res = await api(m, url(), token).send(body);
          expect(res.status).toBe(401);
          // auth's bare UnauthorizedException() has no `error` field; needs the global exception filter (not built).
          expect(res.body).toMatchObject({
            statusCode: 401,
            message: expect.any(String),
          });
        }
        expect((await api(m, url(), user).send(body)).status).toBe(403);
      },
    );

    it('SUPER_ADMIN may create, update, set status and delete', async () => {
      const sa = await signToken(app, 'SUPER_ADMIN');
      const made = await api('post', `/admin/places/${P}/seats`, sa).send({
        label: lbl(),
      });
      expect(made.status).toBe(201);
      const { id } = made.body;
      seatIds.push(id);
      expect(
        (await api('patch', `/admin/seats/${id}`, sa).send({ label: lbl() }))
          .status,
      ).toBe(200);
      expect(
        (
          await api('patch', `/admin/seats/${id}/status`, sa).send({
            status: 'MAINTENANCE',
          })
        ).status,
      ).toBe(200);
      await api('delete', `/admin/seats/${id}`, sa).expect(204);
    });

    it.each(routes)(
      '%s: 401 for an expired token and for a token signed with another secret',
      async (m, url, body) => {
        const jwt = app.get(JwtService);
        const expired = await jwt.signAsync(
          { sub: randomUUID(), role: 'ADMIN' },
          { expiresIn: '-10s' },
        );
        const foreign = await jwt.signAsync(
          { sub: randomUUID(), role: 'ADMIN' },
          { secret: 'x'.repeat(48) },
        );
        for (const token of [expired, foreign]) {
          const res = await api(m, url(), token).send(body);
          expect(res.status).toBe(401);
        }
      },
    );

    const badIdRoutes: Array<['post' | 'patch' | 'delete', string, object?]> = [
      ['post', '/admin/places/abc/seats', { label: 'x' }],
      ['patch', '/admin/seats/abc', { label: 'x' }],
      ['patch', '/admin/seats/abc/status', { status: 'ACTIVE' }],
      ['delete', '/admin/seats/abc', undefined],
    ];
    it.each(badIdRoutes)(
      '%s %s: 400 for a non-uuid path id',
      async (m, url, body) => {
        expect((await api(m, url, admin).send(body)).status).toBe(400);
      },
    );
  });

  describe('place state', () => {
    it('inactive place: admin can create, update, set status and delete; public read is 404', async () => {
      const inactive = await insertPlace(ds);
      placeIds.push(inactive);
      await ds.query(`UPDATE places SET is_active = false WHERE id = $1`, [
        inactive,
      ]);
      const made = await create(inactive, { label: lbl() });
      expect(made.status).toBe(201);
      await api('get', `/seats/${made.body.id}`).expect(404);
      expect(
        (
          await api('patch', `/admin/seats/${made.body.id}`, admin).send({
            label: lbl(),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await api('patch', `/admin/seats/${made.body.id}/status`, admin).send(
            { status: 'UNAVAILABLE' },
          )
        ).status,
      ).toBe(200);
      await api('delete', `/admin/seats/${made.body.id}`, admin).expect(204);
    });

    it('seat of a soft-deleted place: update, status and delete are 404', async () => {
      const gone = await insertPlace(ds);
      placeIds.push(gone);
      const made = await create(gone, { label: lbl() });
      expect(made.status).toBe(201);
      await ds.query(`UPDATE places SET deleted_at = now() WHERE id = $1`, [
        gone,
      ]);
      expect(
        (
          await api('patch', `/admin/seats/${made.body.id}`, admin).send({
            label: lbl(),
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await api('patch', `/admin/seats/${made.body.id}/status`, admin).send(
            { status: 'UNAVAILABLE' },
          )
        ).status,
      ).toBe(404);
      expect(
        (await api('delete', `/admin/seats/${made.body.id}`, admin)).status,
      ).toBe(404);
    });
  });

  describe('create', () => {
    it('201, defaults, trimmed label, visible publicly', async () => {
      const label = lbl();
      const res = await create(P, { label: `  ${label}  ` });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        placeId: P,
        label,
        areaId: null,
        features: {},
        status: 'ACTIVE',
      });
      expect(res.body.deletedAt).toBeUndefined();
      await api('get', `/seats/${res.body.id}`).expect(200);
    });

    it('accepts area of the same place and features', async () => {
      const res = await create(P, {
        label: lbl(),
        areaId: A,
        features: { power: true, n: 2, desk: 'large' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        areaId: A,
        features: { power: true, n: 2, desk: 'large' },
      });
    });

    it.each([
      ['empty label', { label: '' }],
      ['31-char label', { label: 'x'.repeat(31) }],
      ['placeId in body', { label: 'ok', placeId: randomUUID() }],
      ['status in body', { label: 'ok', status: 'ACTIVE' }],
      ['id in body', { label: 'ok', id: randomUUID() }],
      ['features array', { label: 'ok', features: [1] }],
      [
        '21 features',
        {
          label: 'ok',
          features: Object.fromEntries(
            Array.from({ length: 21 }, (_, i) => [`k${i}`, true]),
          ),
        },
      ],
      ['nested features', { label: 'ok', features: { a: { b: 1 } } }],
      [
        '51-char feature string',
        { label: 'ok', features: { a: 'x'.repeat(51) } },
      ],
    ])('400 on %s', async (_n, body) => {
      expect((await create(P, body)).status).toBe(400);
    });

    it.each([
      ['a newline', 'a\nb'],
      ['a tab', 'a\tb'],
      ['a NUL character', 'a\u0000b'],
    ])('400 on label with %s', async (_n, label) => {
      expect((await create(P, { label })).status).toBe(400);
    });

    it.each([['Bàn 12'], ['座位-3']])('201 on label %s', async (label) => {
      const res = await create(P, { label });
      expect(res.status).toBe(201);
      expect(res.body.label).toBe(label);
    });

    it('404 for unknown or soft-deleted place', async () => {
      expect((await create(randomUUID(), { label: lbl() })).status).toBe(404);
      const gone = await insertPlace(ds);
      placeIds.push(gone);
      await ds.query(`UPDATE places SET deleted_at = now() WHERE id = $1`, [
        gone,
      ]);
      expect((await create(gone, { label: lbl() })).status).toBe(404);
    });

    it('400 for area of another place, soft-deleted area, or unknown area', async () => {
      const other = await insertArea(ds, P2);
      const dead = await insertArea(ds, P);
      areaIds.push(other, dead);
      await ds.query(`UPDATE areas SET deleted_at = now() WHERE id = $1`, [
        dead,
      ]);
      for (const areaId of [other, dead, randomUUID()])
        expect((await create(P, { label: lbl(), areaId })).status).toBe(400);
    });

    it('409 on duplicate label in the same place, 201 in another place', async () => {
      const label = lbl();
      expect((await create(P, { label })).status).toBe(201);
      expect((await create(P, { label })).status).toBe(409);
      expect((await create(P2, { label })).status).toBe(201);
    });

    it.each([
      [
        'exactly 20 feature keys',
        Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`k${i}`, true]),
        ),
      ],
      ['a 50-char feature string', { a: 'x'.repeat(50) }],
      ['a 30-char feature key', { ['k'.repeat(30)]: 1 }],
    ])('201 on %s', async (_n, features) => {
      const res = await create(P, { label: lbl(), features });
      expect(res.status).toBe(201);
      expect(res.body.features).toEqual(features);
    });

    it.each([
      ['an empty key', { '': true }],
      ['a 31-char key', { ['k'.repeat(31)]: 1 }],
      ['a null value', { a: null }],
      ['an array value', { a: [1] }],
    ])('400 on features with %s', async (_n, features) => {
      expect((await create(P, { label: lbl(), features })).status).toBe(400);
    });

    it('null features and null areaId are accepted as defaults', async () => {
      const res = await create(P, {
        label: lbl(),
        features: null,
        areaId: null,
      });
      expect(res.status).toBe(201);
      expect(res.body.features).toEqual({});
      expect(res.body.areaId).toBeNull();
    });
  });

  describe('update', () => {
    it('updates label/features, advances updatedAt, clears area with null', async () => {
      const made = (await create(P, { label: lbl(), areaId: A })).body;
      await new Promise((r) => setTimeout(r, 10));
      const label = lbl();
      const res = await api('patch', `/admin/seats/${made.id}`, admin).send({
        label,
        features: { window: true },
        areaId: null,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        label,
        features: { window: true },
        areaId: null,
      });
      expect(Date.parse(res.body.updatedAt)).toBeGreaterThan(
        Date.parse(made.updatedAt),
      );
    });

    it('400 (not 500) for null label or features', async () => {
      const made = (await create(P, { label: lbl() })).body;
      for (const body of [{ label: null }, { features: null }]) {
        const res = await api('patch', `/admin/seats/${made.id}`, admin).send(
          body,
        );
        expect(res.status).toBe(400);
      }
    });

    it('409 label taken; 400 placeId in body or foreign area; 404 unknown/deleted seat', async () => {
      const a = (await create(P, { label: lbl() })).body;
      const b = (await create(P, { label: lbl() })).body;
      const patch = (id: string, body: object) =>
        api('patch', `/admin/seats/${id}`, admin).send(body);
      expect((await patch(b.id, { label: a.label })).status).toBe(409);
      expect((await patch(b.id, { placeId: P2 })).status).toBe(400);
      const other = await insertArea(ds, P2);
      areaIds.push(other);
      expect((await patch(b.id, { areaId: other })).status).toBe(400);
      expect((await patch(randomUUID(), { label: lbl() })).status).toBe(404);
      await api('delete', `/admin/seats/${b.id}`, admin).expect(204);
      expect((await patch(b.id, { label: lbl() })).status).toBe(404);
    });

    it('400 for a label with control characters', async () => {
      const made = (await create(P, { label: lbl() })).body;
      for (const label of ['a\nb', 'a\tb', 'a\u0000b']) {
        const res = await api('patch', `/admin/seats/${made.id}`, admin).send({
          label,
        });
        expect(res.status).toBe(400);
      }
      const res = await api('get', `/seats/${made.id}`);
      expect(res.body.label).toBe(made.label);
    });

    it('empty body: 200, nothing changed, updatedAt not advanced', async () => {
      const made = (await create(P, { label: lbl() })).body;
      await new Promise((r) => setTimeout(r, 10));
      const res = await api('patch', `/admin/seats/${made.id}`, admin).send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual(made);
    });

    it('own current label: 200, not 409, updatedAt not advanced', async () => {
      const made = (await create(P, { label: lbl() })).body;
      await new Promise((r) => setTimeout(r, 10));
      const res = await api('patch', `/admin/seats/${made.id}`, admin).send({
        label: made.label,
      });
      expect(res.status).toBe(200);
      expect(res.body.updatedAt).toBe(made.updatedAt);
    });

    it('unchanged areaId and features: 200, updatedAt not advanced', async () => {
      const made = (
        await create(P, {
          label: lbl(),
          areaId: A,
          features: { power: true },
        })
      ).body;
      await new Promise((r) => setTimeout(r, 10));
      const res = await api('patch', `/admin/seats/${made.id}`, admin).send({
        areaId: A,
        features: { power: true },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(made);
    });

    describe('validation', () => {
      let seatId: string;
      beforeAll(async () => {
        seatId = (await create(P, { label: lbl() })).body.id;
      });
      it.each([
        ['blank label', { label: '   ' }],
        ['31-char label', { label: 'x'.repeat(31) }],
        ['features array', { features: [1] }],
        ['status in body', { status: 'MAINTENANCE' }],
        ['non-uuid areaId', { areaId: 'abc' }],
      ])('400 on %s', async (_n, body) => {
        const res = await api('patch', `/admin/seats/${seatId}`, admin).send(
          body,
        );
        expect(res.status).toBe(400);
      });
    });

    it('areaId: 400 for a soft-deleted or unknown area, 200 for a live area of the same place', async () => {
      const made = (await create(P, { label: lbl() })).body;
      const dead = await insertArea(ds, P);
      areaIds.push(dead);
      await ds.query(`UPDATE areas SET deleted_at = now() WHERE id = $1`, [
        dead,
      ]);
      expect(
        (
          await api('patch', `/admin/seats/${made.id}`, admin).send({
            areaId: dead,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await api('patch', `/admin/seats/${made.id}`, admin).send({
            areaId: randomUUID(),
          })
        ).status,
      ).toBe(400);
      const res = await api('patch', `/admin/seats/${made.id}`, admin).send({
        areaId: A,
      });
      expect(res.status).toBe(200);
      expect(res.body.areaId).toBe(A);
    });

    it('changing only features leaves label, areaId and status unchanged', async () => {
      const made = (await create(P, { label: lbl(), areaId: A })).body;
      const res = await api('patch', `/admin/seats/${made.id}`, admin).send({
        features: { window: true },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        label: made.label,
        areaId: A,
        status: 'ACTIVE',
        features: { window: true },
      });
    });
  });

  describe('status', () => {
    it('sets MAINTENANCE and filters publicly; 400 on bad status', async () => {
      const made = (await create(P, { label: lbl() })).body;
      const res = await api(
        'patch',
        `/admin/seats/${made.id}/status`,
        admin,
      ).send({ status: 'MAINTENANCE' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('MAINTENANCE');
      const list = await api(
        'get',
        `/seats?status=MAINTENANCE&placeId=${P}&limit=100`,
      );
      expect(list.body.items.map((s: { id: string }) => s.id)).toContain(
        made.id,
      );
      expect(
        (
          await api('patch', `/admin/seats/${made.id}/status`, admin).send({
            status: 'BROKEN',
          })
        ).status,
      ).toBe(400);
    });

    it('same status twice: 200, updatedAt not advanced', async () => {
      const made = (await create(P, { label: lbl() })).body;
      await new Promise((r) => setTimeout(r, 10));
      const res = await api(
        'patch',
        `/admin/seats/${made.id}/status`,
        admin,
      ).send({ status: 'ACTIVE' });
      expect(res.status).toBe(200);
      expect(res.body.updatedAt).toBe(made.updatedAt);
    });

    it.each([
      ['missing status', {}],
      ['extra field', { status: 'ACTIVE', label: 'x' }],
      ['null status', { status: null }],
    ])('400 on %s', async (_n, body) => {
      const made = (await create(P, { label: lbl() })).body;
      const res = await api(
        'patch',
        `/admin/seats/${made.id}/status`,
        admin,
      ).send(body);
      expect(res.status).toBe(400);
    });

    it('round trip UNAVAILABLE -> ACTIVE is reflected in the public status filter', async () => {
      const made = (await create(P, { label: lbl() })).body;
      const res = await api(
        'patch',
        `/admin/seats/${made.id}/status`,
        admin,
      ).send({ status: 'UNAVAILABLE' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UNAVAILABLE');
      const unavailableIds = (
        await api('get', `/seats?status=UNAVAILABLE&placeId=${P}&limit=100`)
      ).body.items.map((s: { id: string }) => s.id);
      expect(unavailableIds).toContain(made.id);
      const activeIds = (
        await api('get', `/seats?status=ACTIVE&placeId=${P}&limit=100`)
      ).body.items.map((s: { id: string }) => s.id);
      expect(activeIds).not.toContain(made.id);
      const back = await api(
        'patch',
        `/admin/seats/${made.id}/status`,
        admin,
      ).send({ status: 'ACTIVE' });
      expect(back.status).toBe(200);
      const activeAfter = (
        await api('get', `/seats?status=ACTIVE&placeId=${P}&limit=100`)
      ).body.items.map((s: { id: string }) => s.id);
      expect(activeAfter).toContain(made.id);
      const unavailableAfter = (
        await api('get', `/seats?status=UNAVAILABLE&placeId=${P}&limit=100`)
      ).body.items.map((s: { id: string }) => s.id);
      expect(unavailableAfter).not.toContain(made.id);
    });
  });

  describe('delete', () => {
    it('204, then 404 twice, hidden publicly, label reusable', async () => {
      const label = lbl();
      const made = (await create(P, { label })).body;
      await api('delete', `/admin/seats/${made.id}`, admin).expect(204);
      await api('delete', `/admin/seats/${made.id}`, admin).expect(404);
      await api('get', `/seats/${made.id}`).expect(404);
      expect((await create(P, { label })).status).toBe(201);
    });

    describe('live bookings', () => {
      // Someone is in the seat: staff check them out first.
      it.each(['CHECKED_IN', 'CHECKOUT_OVERDUE'])(
        '409 while the seat has a %s booking, seat still readable',
        async (status) => {
          const made = (await create(P, { label: lbl() })).body;
          await insertBooking(made.id, await insertUser(), status);
          const res = await api('delete', `/admin/seats/${made.id}`, admin);
          expect(res.status).toBe(409);
          expect(res.body.message).toBe(
            'Seat still has active bookings; cancel or complete them first',
          );
          await api('get', `/seats/${made.id}`).expect(200);
        },
      );

      it('204 when the seat only has CANCELLED, COMPLETED and EXPIRED bookings', async () => {
        const made = (await create(P, { label: lbl() })).body;
        const u = await insertUser();
        for (const status of ['CANCELLED', 'COMPLETED', 'EXPIRED'])
          await insertBooking(made.id, u, status);
        await api('delete', `/admin/seats/${made.id}`, admin).expect(204);
      });

      it('204 once the checked-in booking is completed', async () => {
        const made = (await create(P, { label: lbl() })).body;
        const bookingId = await insertBooking(
          made.id,
          await insertUser(),
          'CHECKED_IN',
        );
        await api('delete', `/admin/seats/${made.id}`, admin).expect(409);
        await ds.query(
          `UPDATE bookings SET status = 'COMPLETED', checked_out_at = now(), check_out_method = 'MANUAL' WHERE id = $1`,
          [bookingId],
        );
        await api('delete', `/admin/seats/${made.id}`, admin).expect(204);
      });

      // docs/improvement-plan.md item 1: a PENDING booking would otherwise
      // expire as a no-show the user didn't cause.
      it('204 with a PENDING booking, which is cancelled in the same transaction', async () => {
        const made = (await create(P, { label: lbl() })).body;
        const bookingId = await insertBooking(
          made.id,
          await insertUser(),
          'PENDING',
        );
        await api('delete', `/admin/seats/${made.id}`, admin).expect(204);
        const [row] = await ds.query(
          `SELECT status FROM bookings WHERE id = $1`,
          [bookingId],
        );
        expect(row.status).toBe('CANCELLED');
      });

      it('status change to MAINTENANCE is allowed with a live booking', async () => {
        const made = (await create(P, { label: lbl() })).body;
        await insertBooking(made.id, await insertUser(), 'PENDING');
        const res = await api(
          'patch',
          `/admin/seats/${made.id}/status`,
          admin,
        ).send({ status: 'MAINTENANCE' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('MAINTENANCE');
        // The PENDING booking can't happen any more: cancelled, not left to expire.
        const [row] = await ds.query(
          `SELECT status FROM bookings WHERE seat_id = $1`,
          [made.id],
        );
        expect(row.status).toBe('CANCELLED');
      });
    });
  });

  describe('response shape', () => {
    it('every admin 2xx body has exactly the 8 seat keys', async () => {
      const made = await create(P, { label: lbl() });
      expect(made.status).toBe(201);
      const updated = await api(
        'patch',
        `/admin/seats/${made.body.id}`,
        admin,
      ).send({ label: lbl() });
      expect(updated.status).toBe(200);
      const status = await api(
        'patch',
        `/admin/seats/${made.body.id}/status`,
        admin,
      ).send({ status: 'MAINTENANCE' });
      expect(status.status).toBe(200);
      const keys = [
        'areaId',
        'createdAt',
        'features',
        'id',
        'label',
        'placeId',
        'status',
        'updatedAt',
      ];
      for (const body of [made.body, updated.body, status.body]) {
        expect(Object.keys(body).sort()).toEqual(keys);
      }
    });
  });
});

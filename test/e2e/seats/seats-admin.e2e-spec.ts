import { INestApplication } from '@nestjs/common';
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

    it.each([
      ['Bàn 12'],
      ['座位-3'],
    ])('201 on label %s', async (label) => {
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
  });
});

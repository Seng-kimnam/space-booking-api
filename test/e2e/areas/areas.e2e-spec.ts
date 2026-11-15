import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { signToken } from '../../utils/auth-tokens';
import { deleteRows, insertPlace } from '../../utils/fixtures';

describe('areas (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let superAdmin: string;
  let user: string;
  let placeId: string;
  const placeIds: string[] = [];
  const areaIds: string[] = [];
  const seatIds: string[] = [];

  const api = (
    m: 'post' | 'patch' | 'delete' | 'get',
    url: string,
    token?: string,
  ) => {
    const r = request(app.getHttpServer())[m](`/api/v1${url}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const create = async (body: object, place = placeId, token = admin) => {
    const res = await api('post', `/admin/places/${place}/areas`, token).send(
      body,
    );
    if (res.body.id) areaIds.push(res.body.id);
    return res;
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    admin = await signToken(app, 'ADMIN');
    superAdmin = await signToken(app, 'SUPER_ADMIN');
    user = await signToken(app, 'USER');
    placeId = await insertPlace(ds);
    placeIds.push(placeId);
  });

  afterAll(async () => {
    await deleteRows(ds, 'seats', seatIds);
    await deleteRows(ds, 'areas', areaIds);
    await deleteRows(ds, 'places', placeIds);
    await app.close();
  });

  describe('authentication and authorization', () => {
    const id = randomUUID();
    const routes: Array<['post' | 'patch' | 'delete', string, object?]> = [
      ['post', `/admin/places/${id}/areas`, { name: 'x' }],
      ['patch', `/admin/areas/${id}`, { name: 'x' }],
      ['delete', `/admin/areas/${id}`, undefined],
    ];
    it.each(routes)(
      '%s %s: 401 without/invalid token, 403 for USER',
      async (m, url, body) => {
        for (const token of [undefined, 'garbage'])
          expect((await api(m, url, token).send(body)).status).toBe(401);
        expect((await api(m, url, user).send(body)).status).toBe(403);
      },
    );

    it('SUPER_ADMIN passes ADMIN routes', async () => {
      const res = await create({ name: `sa-${randomUUID()}` }, placeId, superAdmin);
      expect(res.status).toBe(201);
    });
  });

  describe('POST /admin/places/:placeId/areas', () => {
    it('201 with trimmed name and defaults', async () => {
      const res = await create({ name: '  Quiet zone  ', floor: ' 2 ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        placeId,
        name: 'Quiet zone',
        floor: '2',
        description: null,
        isActive: true,
      });
      expect(Object.keys(res.body)).not.toContain('deletedAt');
    });

    it('400 on invalid or unknown fields', async () => {
      for (const body of [{}, { name: '' }, { name: 'x', extra: 1 }, { name: 'x', isActive: 'yes' }])
        expect((await create(body)).status).toBe(400);
    });

    it('404 for an unknown place', async () => {
      expect((await create({ name: 'x' }, randomUUID())).status).toBe(404);
    });

    it('409 for a duplicate name in the same place', async () => {
      const name = `dup-${randomUUID()}`;
      expect((await create({ name })).status).toBe(201);
      expect((await create({ name })).status).toBe(409);
    });
  });

  describe('PATCH /admin/areas/:areaId', () => {
    it('updates fields and clears nullable ones with null', async () => {
      const { body: area } = await create({
        name: `p-${randomUUID()}`,
        floor: '1',
        description: 'd',
      });
      const res = await api('patch', `/admin/areas/${area.id}`, admin).send({
        floor: null,
        description: null,
        isActive: false,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        floor: null,
        description: null,
        isActive: false,
      });
    });

    it('400 for null on a NOT NULL field, 404 for an unknown area', async () => {
      const { body: area } = await create({ name: `n-${randomUUID()}` });
      expect(
        (await api('patch', `/admin/areas/${area.id}`, admin).send({ name: null })).status,
      ).toBe(400);
      expect(
        (await api('patch', `/admin/areas/${randomUUID()}`, admin).send({ name: 'x' })).status,
      ).toBe(404);
    });
  });

  describe('DELETE /admin/areas/:areaId', () => {
    it('409 while a seat is assigned, 204 once it is gone, then 404', async () => {
      const { body: area } = await create({ name: `d-${randomUUID()}` });
      const [seat] = await ds.query(
        `INSERT INTO seats (place_id, area_id, label) VALUES ($1, $2, $3) RETURNING id`,
        [placeId, area.id, `S-${randomUUID().slice(0, 8)}`],
      );
      seatIds.push(seat.id);

      expect((await api('delete', `/admin/areas/${area.id}`, admin)).status).toBe(409);
      await ds.query('UPDATE seats SET deleted_at = now() WHERE id = $1', [seat.id]);
      expect((await api('delete', `/admin/areas/${area.id}`, admin)).status).toBe(204);
      expect((await api('delete', `/admin/areas/${area.id}`, admin)).status).toBe(404);
    });
  });

  describe('GET /places/:placeId/areas (public)', () => {
    let listPlace: string;

    beforeAll(async () => {
      listPlace = await insertPlace(ds);
      placeIds.push(listPlace);
      for (const name of ['Bravo', 'Alpha', 'Charlie'])
        expect((await create({ name }, listPlace)).status).toBe(201);
      expect((await create({ name: 'Hidden', isActive: false }, listPlace)).status).toBe(201);
    });

    const names = (res: request.Response) =>
      (res.body.items as Array<{ name: string }>).map((a) => a.name);

    it('lists active areas by name, paginated', async () => {
      const res = await api('get', `/places/${listPlace}/areas?limit=2`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 2, total: 3 });
      expect(names(res)).toEqual(['Alpha', 'Bravo']);

      const page2 = await api('get', `/places/${listPlace}/areas?limit=2&page=2`);
      expect(names(page2)).toEqual(['Charlie']);
    });

    it('sorts with sortBy/order and rejects unknown sort fields', async () => {
      const desc = await api('get', `/places/${listPlace}/areas?order=DESC`);
      expect(names(desc)).toEqual(['Charlie', 'Bravo', 'Alpha']);

      const byCreated = await api('get', `/places/${listPlace}/areas?sortBy=createdAt`);
      expect(byCreated.status).toBe(200);
      expect(names(byCreated)).toEqual(['Bravo', 'Alpha', 'Charlie']);

      for (const q of ['sortBy=floor', 'order=up', 'limit=101', 'page=0', 'foo=1'])
        expect((await api('get', `/places/${listPlace}/areas?${q}`)).status).toBe(400);
    });

    it('404 for an unknown or inactive place', async () => {
      expect((await api('get', `/places/${randomUUID()}/areas`)).status).toBe(404);
      const inactive = await insertPlace(ds);
      placeIds.push(inactive);
      await ds.query('UPDATE places SET is_active = false WHERE id = $1', [inactive]);
      expect((await api('get', `/places/${inactive}/areas`)).status).toBe(404);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signToken } from '../../utils/auth-tokens';
import { createTestApp } from '../../utils/create-test-app';

describe('admin roles (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let user: string;
  const createdIds: number[] = [];

  const api = (
    m: 'post' | 'patch' | 'delete' | 'get',
    url: string,
    token?: string,
  ) => {
    const r = request(app.getHttpServer())[m](`/api/v1${url}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  // Role names must match ^[A-Z][A-Z0-9_]*$ and fit in 30 chars.
  const uniqueName = () => `E2E_${randomUUID().slice(0, 8).toUpperCase()}`;
  const create = async (name: unknown) => {
    const res = await api('post', '/admin/roles', admin).send({ name });
    if (res.body.id) createdIds.push(res.body.id);
    return res;
  };
  const protectedId = async (name: string): Promise<number> =>
    (
      await ds.query<{ id: number }[]>(`SELECT id FROM roles WHERE name = $1`, [
        name,
      ])
    )[0].id;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    admin = await signToken(app, 'ADMIN');
    user = await signToken(app, 'USER');
  });

  afterAll(async () => {
    if (createdIds.length) {
      await ds.query(`DELETE FROM roles WHERE id = ANY($1)`, [createdIds]);
    }
    await app.close();
  });

  describe('authentication and authorization (AuthGuard, RolesGuard)', () => {
    const routes: Array<
      ['post' | 'patch' | 'delete' | 'get', string, object?]
    > = [
      ['get', '/admin/roles', undefined],
      ['get', '/admin/roles/1', undefined],
      ['post', '/admin/roles', { name: 'XX' }],
      ['patch', '/admin/roles/1', { name: 'XX' }],
      ['delete', '/admin/roles/1', undefined],
    ];
    it.each(routes)(
      '%s %s: 401 without/invalid token, 403 for USER',
      async (m, url, body) => {
        for (const token of [undefined, 'garbage'])
          expect((await api(m, url, token).send(body)).status).toBe(401);
        expect((await api(m, url, user).send(body)).status).toBe(403);
      },
    );

    it('the old unauthenticated /roles route is gone', async () => {
      expect((await api('get', '/roles')).status).toBe(404);
    });
  });

  describe('create', () => {
    it('201, trims and uppercases the name', async () => {
      const name = uniqueName();
      const res = await create(`  ${name.toLowerCase()}  `);
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(name);
      expect(Object.keys(res.body).sort()).toEqual([
        'createdAt',
        'id',
        'name',
        'updatedAt',
      ]);
    });

    it('409 on duplicate name, also when only the case differs', async () => {
      const name = uniqueName();
      expect((await create(name)).status).toBe(201);
      expect((await create(name)).status).toBe(409);
      expect((await create(name.toLowerCase())).status).toBe(409);
    });

    it.each([
      '',
      'A',
      '1ABC',
      'HAS SPACE',
      'BAD-CHAR',
      'X'.repeat(31),
      null,
      42,
    ])('400 for invalid name %p', async (name) => {
      expect((await create(name)).status).toBe(400);
    });

    it('400 for unknown fields', async () => {
      const res = await api('post', '/admin/roles', admin).send({
        name: uniqueName(),
        id: 1,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('list', () => {
    it('200 paginated', async () => {
      const res = await api('get', '/admin/roles?page=1&limit=1', admin);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 1 });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('filters by search, case-insensitively', async () => {
      const name = uniqueName();
      await create(name);
      const res = await api(
        'get',
        `/admin/roles?search=${name.slice(4).toLowerCase()}`,
        admin,
      );
      expect(res.status).toBe(200);
      expect(res.body.items.map((r: { name: string }) => r.name)).toEqual([
        name,
      ]);
    });

    it.each(['limit=101', 'page=0', 'search=', 'unknown=1'])(
      '400 for ?%s',
      async (qs) => {
        expect((await api('get', `/admin/roles?${qs}`, admin)).status).toBe(
          400,
        );
      },
    );
  });

  describe('update and delete', () => {
    it('renames and deletes a custom role', async () => {
      const { body } = await create(uniqueName());
      const renamed = uniqueName();
      const patch = await api('patch', `/admin/roles/${body.id}`, admin).send({
        name: renamed,
      });
      expect(patch.status).toBe(200);
      expect(patch.body.name).toBe(renamed);

      expect(
        (await api('delete', `/admin/roles/${body.id}`, admin)).status,
      ).toBe(204);
      expect((await api('get', `/admin/roles/${body.id}`, admin)).status).toBe(
        404,
      );
    });

    it('400 for a null or invalid new name', async () => {
      const { body } = await create(uniqueName());
      for (const name of [null, '', 'BAD-CHAR'])
        expect(
          (await api('patch', `/admin/roles/${body.id}`, admin).send({ name }))
            .status,
        ).toBe(400);
    });

    it.each(['ADMIN', 'USER'])(
      '409 when renaming or deleting %s',
      async (name) => {
        const id = await protectedId(name);
        const patch = await api('patch', `/admin/roles/${id}`, admin).send({
          name: uniqueName(),
        });
        expect(patch.status).toBe(409);
        expect((await api('delete', `/admin/roles/${id}`, admin)).status).toBe(
          409,
        );
        expect((await api('get', `/admin/roles/${id}`, admin)).body.name).toBe(
          name,
        );
      },
    );

    it.each(['abc', '0', '-1', '1.5', '2147483648'])(
      '400 for id %p on every :id route',
      async (id) => {
        expect((await api('get', `/admin/roles/${id}`, admin)).status).toBe(
          400,
        );
        expect(
          (await api('patch', `/admin/roles/${id}`, admin).send({ name: 'XX' }))
            .status,
        ).toBe(400);
        expect((await api('delete', `/admin/roles/${id}`, admin)).status).toBe(
          400,
        );
      },
    );

    it('404 for an unknown id', async () => {
      expect((await api('get', '/admin/roles/2147483647', admin)).status).toBe(
        404,
      );
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OtpPurpose } from '../../../src/common/enums';
import { OtpService } from '../../../src/users/services/otp.service';
import { signToken } from '../../utils/auth-tokens';
import { createTestApp } from '../../utils/create-test-app';

/**
 * Users module against a real Postgres: admin account reads (8g/8h),
 * PATCH /users/me, and the Telegram link codes (OtpService, user_otps).
 */
describe('Users (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  const tag = `e2eusr${Date.now().toString(36)}`;
  const ids: Record<'user' | 'suspended' | 'admin', string> = { user: '', suspended: '', admin: '' };
  let userToken: string;

  const api = (m: 'get' | 'patch', url: string, token?: string) => {
    const r = request(app.getHttpServer())[m](`/api/v1${url}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const insertUser = async (role: string, name: string, active = true) => {
    const [row] = await ds.query(
      `INSERT INTO users (role_id, name, email, password_hash, is_active, email_verified_at)
       VALUES ((SELECT id FROM roles WHERE name = $1), $2, $3, 'not-a-real-hash', $4, now())
       RETURNING id`,
      [role, name, `${name.toLowerCase().replace(/\W/g, '')}@${tag}.test`, active],
    );
    return row.id as string;
  };

  beforeAll(async () => {
    if (!process.env.DB_NAME?.endsWith('_test')) {
      throw new Error('Run against a dedicated *_test database: DB_NAME=..._test npm run test:e2e');
    }
    app = await createTestApp();
    ds = app.get(DataSource);
    ids.user = await insertUser('USER', `${tag} Alice`);
    ids.suspended = await insertUser('USER', `${tag} Bob_50%`, false);
    ids.admin = await insertUser('ADMIN', `${tag} Carol`);
    admin = await signToken(app, 'ADMIN', ids.admin);
    userToken = await signToken(app, 'USER', ids.user);
  });

  afterAll(async () => {
    await ds.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids).filter(Boolean)]);
    await app.close();
  });

  describe('GET /admin/users', () => {
    it('needs a token and an admin role', async () => {
      await api('get', '/admin/users').expect(401);
      await api('get', '/admin/users', userToken).expect(403);
      await api('get', '/admin/users', await signToken(app, 'SUPER_ADMIN')).expect(200);
    });

    it('filters by q, role and isActive, and paginates', async () => {
      const all = await api('get', `/admin/users?q=${tag}`, admin).expect(200);
      expect(all.body.total).toBe(3);

      const users = await api('get', `/admin/users?q=${tag}&role=USER`, admin).expect(200);
      expect(users.body.items.map((u: { id: string }) => u.id).sort()).toEqual(
        [ids.user, ids.suspended].sort(),
      );

      const suspended = await api('get', `/admin/users?q=${tag}&isActive=false`, admin).expect(200);
      expect(suspended.body.items.map((u: { id: string }) => u.id)).toEqual([ids.suspended]);

      const page = await api('get', `/admin/users?q=${tag}&limit=2&page=2`, admin).expect(200);
      expect(page.body).toMatchObject({ page: 2, limit: 2, total: 3 });
      expect(page.body.items).toHaveLength(1);
    });

    it('matches % and _ in q literally', async () => {
      const res = await api('get', `/admin/users?q=${encodeURIComponent('Bob_50%')}`, admin).expect(200);
      expect(res.body.items.map((u: { id: string }) => u.id)).toEqual([ids.suspended]);
      const none = await api('get', `/admin/users?q=${tag}%25Alice`, admin).expect(200);
      expect(none.body.total).toBe(0);
    });

    it('rejects bad filters', async () => {
      await api('get', '/admin/users?role=ROOT', admin).expect(400);
      await api('get', '/admin/users?isActive=maybe', admin).expect(400);
      await api('get', '/admin/users?limit=500', admin).expect(400);
    });
  });

  describe('GET /admin/users/:userId', () => {
    it('returns the account without secrets', async () => {
      const res = await api('get', `/admin/users/${ids.user}`, admin).expect(200);
      expect(res.body).toMatchObject({ id: ids.user, role: 'USER', isActive: true, noShowCount: 0 });
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('googleId');
      expect(JSON.stringify(res.body)).not.toContain('not-a-real-hash');
    });

    it('404 for an unknown id, 400 for a non-UUID', async () => {
      await api('get', `/admin/users/${randomUUID()}`, admin).expect(404);
      await api('get', '/admin/users/not-a-uuid', admin).expect(400);
    });
  });

  describe('PATCH /users/me', () => {
    it('needs a token', async () => {
      await api('patch', '/users/me').send({ name: 'x' }).expect(401);
    });

    it('updates name and avatar of the caller only', async () => {
      const res = await api('patch', '/users/me', userToken)
        .send({ name: `${tag} Alice B`, avatarUrl: 'https://img.example/a.png' })
        .expect(200);
      expect(res.body).toMatchObject({
        id: ids.user,
        name: `${tag} Alice B`,
        avatarUrl: 'https://img.example/a.png',
        role: 'USER',
      });
      const [row] = await ds.query('SELECT avatar_url FROM users WHERE id = $1', [ids.user]);
      expect(row.avatar_url).toBe('https://img.example/a.png');

      const cleared = await api('patch', '/users/me', userToken).send({ avatarUrl: null }).expect(200);
      expect(cleared.body.avatarUrl).toBeNull();
    });

    it('rejects role, email, or a null name', async () => {
      await api('patch', '/users/me', userToken).send({ role: 'ADMIN' }).expect(400);
      await api('patch', '/users/me', userToken).send({ email: 'x@y.z' }).expect(400);
      await api('patch', '/users/me', userToken).send({ name: null }).expect(400);
      const [row] = await ds.query(
        'SELECT r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1',
        [ids.user],
      );
      expect(row.role).toBe('USER');
    });

    it('404 when the token belongs to no account', async () => {
      await api('patch', '/users/me', await signToken(app, 'USER')).send({ name: 'x' }).expect(404);
    });
  });

  describe('OtpService (Telegram link codes)', () => {
    it('codes are single use and only the latest one is live', async () => {
      const otp = app.get(OtpService);
      const first = await otp.issue(ids.user, OtpPurpose.TELEGRAM_LINK, 10);
      const second = await otp.issue(ids.user, OtpPurpose.TELEGRAM_LINK, 10);

      await expect(otp.consume(first.code, OtpPurpose.TELEGRAM_LINK)).resolves.toBeNull();
      await expect(otp.consume(second.code, OtpPurpose.TELEGRAM_LINK)).resolves.toBe(ids.user);
      await expect(otp.consume(second.code, OtpPurpose.TELEGRAM_LINK)).resolves.toBeNull();

      const rows = await ds.query('SELECT code_hash FROM user_otps WHERE user_id = $1', [ids.user]);
      expect(JSON.stringify(rows)).not.toContain(second.code);
    });
  });
});

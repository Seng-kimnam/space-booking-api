import { ForbiddenException, INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthService } from '../../../src/auth/auth.service';
import { signToken } from '../../utils/auth-tokens';
import { createTestApp } from '../../utils/create-test-app';

// Sessions, suspension and access control against real Postgres:
// docs/auth.md M1 (refresh rotation + reuse), M3 (suspension), the HTTP
// security headers, and the authorization checks from the test-suite list.
// Sessions are opened with AuthService.login directly so the login rate limit
// (10/min per IP) doesn't constrain the suite; HTTP refreshes stay well under
// their 30/min limit.
describe('auth sessions and access control (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let auth: AuthService;
  const emails: string[] = [];
  const password = 'Password123!';
  let passwordHash: string;

  const http = () => request(app.getHttpServer());
  const roleId = async (name: string): Promise<number> =>
    (await ds.query(`SELECT id FROM roles WHERE name = $1`, [name]))[0].id;

  /** A verified, active account with a known password. */
  const newAccount = async (role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' = 'USER') => {
    const email = `e2e-sess-${randomUUID()}@example.test`;
    emails.push(email);
    const [row] = await ds.query(
      `INSERT INTO users (role_id, name, email, password_hash, email_verified_at)
       VALUES ($1, 'E2E', $2, $3, now()) RETURNING id`,
      [await roleId(role), email, passwordHash],
    );
    return { id: row.id as string, email, role };
  };
  const tokenFor = (a: { id: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' }) =>
    signToken(app, a.role, a.id);
  const liveTokens = async (userId: string): Promise<number> =>
    Number(
      (
        await ds.query(
          `SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        )
      )[0].count,
    );
  const refresh = (refreshToken: string) =>
    http().post('/api/v1/auth/refresh-token').send({ refreshToken });

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    auth = app.get(AuthService);
    passwordHash = await bcrypt.hash(password, 4);
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]);
    await app.close();
  });

  describe('refresh rotation (M1)', () => {
    it('rotates, and the new token works', async () => {
      const a = await newAccount();
      const first = await auth.login(a.email, password, { userAgent: 'jest', ip: '127.0.0.1' });

      const res = await refresh(first.refreshToken);
      expect(res.status).toBe(201);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      expect(res.body).not.toHaveProperty('tokenId');
      expect((await refresh(res.body.refreshToken)).status).toBe(201);
    });

    it('the same token refreshed 5 times in parallel succeeds exactly once', async () => {
      const a = await newAccount();
      const { refreshToken } = await auth.login(a.email, password);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => refresh(refreshToken)),
      );
      const winners = results.filter((r) => r.status === 201);
      expect(winners).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(4);
      // A client race is not theft: the winner's session survives.
      expect((await refresh(winners[0].body.refreshToken)).status).toBe(201);
    });

    it('replaying a rotated token revokes every session of the user', async () => {
      const a = await newAccount();
      const { refreshToken: stolen } = await auth.login(a.email, password);
      await auth.login(a.email, password); // a second device
      const rotated = await refresh(stolen);
      expect(rotated.status).toBe(201);
      expect(await liveTokens(a.id)).toBe(2);

      // Move the rotation outside the grace window (REFRESH_REUSE_GRACE_MS).
      await ds.query(
        `UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute'
          WHERE user_id = $1 AND replaced_by_id IS NOT NULL`,
        [a.id],
      );
      expect((await refresh(stolen)).status).toBe(401);
      expect(await liveTokens(a.id)).toBe(0);
      expect((await refresh(rotated.body.refreshToken)).status).toBe(401);
    });

    it('stores where the session came from', async () => {
      const a = await newAccount();
      await auth.login(a.email, password, { userAgent: 'jest-agent', ip: '10.1.2.3' });

      const [row] = await ds.query(
        `SELECT user_agent, host(ip) AS ip FROM refresh_tokens WHERE user_id = $1`,
        [a.id],
      );
      expect(row).toEqual({ user_agent: 'jest-agent', ip: '10.1.2.3' });
    });
  });

  describe('logout', () => {
    it("logout can't revoke someone else's refresh token", async () => {
      const victim = await newAccount();
      const attacker = await newAccount();
      const { refreshToken } = await auth.login(victim.email, password);

      const res = await http()
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${await tokenFor(attacker)}`)
        .send({ refreshToken });
      expect(res.status).toBe(201);
      expect(await liveTokens(victim.id)).toBe(1);
    });

    it('logout-all revokes every session of the caller', async () => {
      const a = await newAccount();
      await auth.login(a.email, password);
      await auth.login(a.email, password);

      const res = await http()
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${await tokenFor(a)}`);
      expect(res.status).toBe(201);
      expect(await liveTokens(a.id)).toBe(0);
    });
  });

  describe('suspension (M3)', () => {
    const suspend = async (actor: { id: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' } | null, userId: string, action = 'suspend') => {
      const r = http().post(`/api/v1/admin/users/${userId}/${action}`);
      return actor ? r.set('Authorization', `Bearer ${await tokenFor(actor)}`) : r;
    };

    it('ADMIN suspends a USER: login 403, refresh 401, sessions revoked; reactivate restores login', async () => {
      const admin = await newAccount('ADMIN');
      const user = await newAccount();
      const { refreshToken } = await auth.login(user.email, password);

      expect((await suspend(admin, user.id)).status).toBe(204);
      expect(await liveTokens(user.id)).toBe(0);
      expect((await refresh(refreshToken)).status).toBe(401);
      await expect(auth.login(user.email, password)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect((await suspend(admin, user.id, 'reactivate')).status).toBe(204);
      await expect(auth.login(user.email, password)).resolves.toHaveProperty('accessToken');
    });

    it('enforces who may suspend whom', async () => {
      const superAdmin = await newAccount('SUPER_ADMIN');
      const admin = await newAccount('ADMIN');
      const otherAdmin = await newAccount('ADMIN');
      const user = await newAccount();

      expect((await suspend(null, user.id)).status).toBe(401);
      expect((await suspend(user, otherAdmin.id)).status).toBe(403); // USER role
      expect((await suspend(admin, otherAdmin.id)).status).toBe(403); // ADMIN -> ADMIN
      expect((await suspend(admin, superAdmin.id)).status).toBe(403); // -> SUPER_ADMIN
      expect((await suspend(admin, admin.id)).status).toBe(403); // self
      expect((await suspend(superAdmin, otherAdmin.id)).status).toBe(204);
      expect((await suspend(admin, randomUUID())).status).toBe(404);
      expect((await suspend(admin, 'not-a-uuid')).status).toBe(400);
    });
  });

  describe('access control', () => {
    it('invalid credentials: 401 with the same body for unknown email and wrong password', async () => {
      const a = await newAccount();
      const unknown = await http()
        .post('/api/v1/auth/login')
        .send({ email: `nobody-${randomUUID()}@example.test`, password });
      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ email: a.email, password: 'WrongPassword1!' });

      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body).toEqual(wrong.body);
    });

    it('USER and ADMIN get 403 on SUPER_ADMIN routes; bad ids are 400', async () => {
      const id = randomUUID();
      for (const role of ['USER', 'ADMIN'] as const) {
        const token = await signToken(app, role);
        for (const [method, url] of [
          ['get', '/api/v1/auth/admin-requests'],
          ['post', `/api/v1/auth/admin-requests/${id}/approve`],
          ['post', `/api/v1/auth/admin-requests/${id}/reject`],
        ] as const) {
          const res = await http()[method](url).set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(403);
        }
      }
      const superAdmin = await newAccount('SUPER_ADMIN');
      const bad = await http()
        .post('/api/v1/auth/admin-requests/not-a-uuid/approve')
        .set('Authorization', `Bearer ${await tokenFor(superAdmin)}`);
      expect(bad.status).toBe(400);
    });

    it('USER gets 403 on /admin/bookings; the /users scaffold needs ADMIN', async () => {
      const user = await signToken(app, 'USER');
      for (const url of ['/api/v1/admin/bookings', '/api/v1/users']) {
        expect((await http().get(url)).status).toBe(401);
        expect(
          (await http().get(url).set('Authorization', `Bearer ${user}`)).status,
        ).toBe(403);
      }
    });
  });

  describe('HTTP headers', () => {
    it('echoes a safe X-Request-Id, or generates one', async () => {
      const echoed = await http().get('/api/v1/health').set('X-Request-Id', 'trace-123');
      expect(echoed.headers['x-request-id']).toBe('trace-123');

      const generated = await http().get('/api/v1/health');
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('sends Helmet security headers and hides the framework', async () => {
      const res = await http().get('/api/v1/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});

import {
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthService, MAX_OTP_ATTEMPTS } from '../../../src/auth/auth.service';
import { createTestApp } from '../../utils/create-test-app';

// docs/auth.md findings C1 (rejected admin request kept ADMIN) and H1 (OTP
// attempt cap and single use bypassed by parallel requests), against real
// Postgres. The OTP races call AuthService directly so the HTTP rate limits
// don't hide what the database does.
describe('auth security fixes (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let auth: AuthService;
  let superAdminId: string;
  const emails: string[] = [];
  const password = 'Password123!';

  const email = () => {
    const e = `e2e-auth-${randomUUID()}@example.test`;
    emails.push(e);
    return e;
  };
  const roleId = async (name: string): Promise<number> =>
    (await ds.query(`SELECT id FROM roles WHERE name = $1`, [name]))[0].id;
  const userRow = async (e: string) =>
    (
      await ds.query(
        `SELECT u.id, r.name AS role, u.admin_request_status AS status
           FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`,
        [e],
      )
    )[0];
  const api = (url: string) =>
    request(app.getHttpServer()).post(`/api/v1${url}`);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    auth = app.get(AuthService);
    const [row] = await ds.query(
      `INSERT INTO users (role_id, name, email, password_hash, email_verified_at)
       VALUES ($1, 'E2E Super Admin', $2, $3, now()) RETURNING id`,
      [await roleId('SUPER_ADMIN'), email(), await bcrypt.hash(password, 4)],
    );
    superAdminId = row.id;
  });

  afterAll(async () => {
    // Cascades to user_otps and refresh_tokens.
    await ds.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]);
    await app.close();
  });

  describe('admin registration (C1, M2)', () => {
    // Register is rate limited to OTP_SEND_LIMITS.ip (5/min per IP) and this
    // app instance is fresh per file: keep this describe at <= 5 registrations.
    const requestAdmin = async () => {
      const e = email();
      const res = await api('/auth/register').send({
        email: e,
        password,
        name: 'E2E Admin Request',
        roleId: await roleId('ADMIN'),
      });
      expect(res.status).toBe(201);
      return { e, user: await userRow(e) };
    };
    // Stands in for the emailed code, which tests can't read (only its hash is stored).
    const markVerified = (id: string) =>
      ds.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [id]);

    it('stores the request as USER + PENDING and unverified', async () => {
      const { e, user } = await requestAdmin();
      expect(user).toMatchObject({ role: 'USER', status: 'PENDING' });
      expect(
        (await ds.query(`SELECT email_verified_at FROM users WHERE email = $1`, [e]))[0]
          .email_verified_at,
      ).toBeNull();
    });

    it('an unverified request is not listed and cannot be approved (M2)', async () => {
      const { user } = await requestAdmin();

      const listed = await auth.listAdminRequests(superAdminId);
      expect(listed.map((r) => r.id)).not.toContain(user.id);
      await expect(
        auth.approveAdminRequest(superAdminId, user.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a verified pending request is listed, and login is blocked (403)', async () => {
      const { e, user } = await requestAdmin();
      await markVerified(user.id);

      const listed = await auth.listAdminRequests(superAdminId);
      expect(listed.map((r) => r.id)).toContain(user.id);
      const login = await api('/auth/login').send({ email: e, password });
      expect(login.status).toBe(403);
    });

    it('a rejected request logs in as USER, never ADMIN', async () => {
      const { e, user } = await requestAdmin();
      await markVerified(user.id);
      await auth.rejectAdminRequest(superAdminId, user.id);

      expect(await userRow(e)).toMatchObject({
        role: 'USER',
        status: 'REJECTED',
      });
      const login = await api('/auth/login').send({ email: e, password });
      expect(login.status).toBe(201);
      expect(login.body.user.role).toBe('USER');
    });

    it('an approved request logs in as ADMIN', async () => {
      const { e, user } = await requestAdmin();
      await markVerified(user.id);
      await auth.approveAdminRequest(superAdminId, user.id);

      const login = await api('/auth/login').send({ email: e, password });
      expect(login.status).toBe(201);
      expect(login.body.user.role).toBe('ADMIN');
    });
  });

  describe('OTP attempts and single use (H1)', () => {
    const code = '246810';
    let userId: string;
    let userEmail: string;

    // A fresh live EMAIL_VERIFY code with a known value (only its hash is stored).
    const freshOtp = async () => {
      await ds.query(
        `UPDATE user_otps SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      const [row] = await ds.query(
        `INSERT INTO user_otps (user_id, purpose, code_hash, expires_at)
         VALUES ($1, 'EMAIL_VERIFY', $2, now() + interval '10 minutes') RETURNING id`,
        [userId, await bcrypt.hash(code, 4)],
      );
      return row.id as string;
    };
    const otpRow = async (id: string) =>
      (await ds.query(`SELECT attempts, used_at FROM user_otps WHERE id = $1`, [id]))[0];

    beforeAll(async () => {
      userEmail = email();
      const [row] = await ds.query(
        `INSERT INTO users (role_id, name, email, password_hash)
         VALUES ($1, 'E2E Unverified', $2, $3) RETURNING id`,
        [await roleId('USER'), userEmail, await bcrypt.hash(password, 4)],
      );
      userId = row.id;
    });

    it(`20 parallel wrong guesses count as at most ${MAX_OTP_ATTEMPTS} attempts, then even the right code fails`, async () => {
      const otpId = await freshOtp();

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          auth.verifyEmail(userEmail, String(100000 + i)),
        ),
      );

      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect((await otpRow(otpId)).attempts).toBe(MAX_OTP_ATTEMPTS);
      await expect(auth.verifyEmail(userEmail, code)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('the right code sent 5 times in parallel succeeds exactly once', async () => {
      const otpId = await freshOtp();

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => auth.verifyEmail(userEmail, code)),
      );

      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      for (const f of failed) {
        expect((f as PromiseRejectedResult).reason).toBeInstanceOf(
          UnauthorizedException,
        );
      }
      expect((await otpRow(otpId)).used_at).not.toBeNull();
    });

    it('a used code cannot be replayed', async () => {
      await freshOtp();
      await auth.verifyEmail(userEmail, code);

      await expect(auth.verifyEmail(userEmail, code)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('an expired code is rejected', async () => {
      const otpId = await freshOtp();
      await ds.query(
        `UPDATE user_otps SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [otpId],
      );

      await expect(auth.verifyEmail(userEmail, code)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect((await otpRow(otpId)).attempts).toBe(0);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { LOGIN_LIMITS, OTP_SEND_LIMITS } from '../../../src/auth/auth-throttle';
import { createTestApp } from '../../utils/create-test-app';

// docs/auth.md finding H2. Throttle counters are in-memory per app instance and
// per route, so each test uses its own route and this file its own app.
// Only unknown emails are used: nothing is written and no mail is sent.
describe('auth rate limits', () => {
  let app: INestApplication;
  const unknownEmail = () => `e2e-throttle-${randomUUID()}@example.test`;
  const api = (url: string) =>
    request(app.getHttpServer()).post(`/api/v1${url}`);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('login: per-IP limit, even when every request uses a different email', async () => {
    const limit = LOGIN_LIMITS.ip.limit;
    for (let i = 0; i < limit; i++) {
      const res = await api('/auth/login').send({
        email: unknownEmail(),
        password: 'WrongPassword1!',
      });
      expect(res.status).toBe(401);
    }

    const blocked = await api('/auth/login').send({
      email: unknownEmail(),
      password: 'WrongPassword1!',
    });
    expect(blocked.status).toBe(429);
  });

  it('forgot-password: per-account limit is hit before the per-IP one', async () => {
    // Same email, any casing: one counter (users.email is citext).
    const e = unknownEmail();
    const limit = OTP_SEND_LIMITS.account.limit;
    expect(limit).toBeLessThan(OTP_SEND_LIMITS.ip.limit);

    for (let i = 0; i < limit; i++) {
      const res = await api('/auth/forgot-password').send({
        email: i % 2 ? e.toUpperCase() : e,
      });
      expect(res.status).toBe(201);
    }

    const blocked = await api('/auth/forgot-password').send({ email: e });
    expect(blocked.status).toBe(429);
  });
});

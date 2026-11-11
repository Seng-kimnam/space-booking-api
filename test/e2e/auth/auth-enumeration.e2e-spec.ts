import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';

// docs/auth.md M4 / AGENTS.md section 6.8: every public auth route answers a
// known and an unknown email identically (status and body). One request per
// route and email, so the rate limits (own app instance) are never reached.
// Mail is sent in the background and its failures are swallowed, so this
// suite doesn't need Mailpit.
describe('no account enumeration (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const emails: string[] = [];
  let known: string;
  let userRoleId: number;

  const post = (url: string, body: object) =>
    request(app.getHttpServer()).post(`/api/v1${url}`).send(body);
  const unknown = () => {
    const e = `e2e-enum-unknown-${randomUUID()}@example.test`;
    emails.push(e); // register may create it
    return e;
  };
  const same = (a: request.Response, b: request.Response) => {
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    userRoleId = (await ds.query(`SELECT id FROM roles WHERE name = 'USER'`))[0].id;
    known = `e2e-enum-known-${randomUUID()}@example.test`;
    emails.push(known);
    await ds.query(
      `INSERT INTO users (role_id, name, email, password_hash, email_verified_at)
       VALUES ($1, 'E2E Known', $2, $3, now())`,
      [userRoleId, known, await bcrypt.hash('Password123!', 4)],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]);
    await app.close();
  });

  it('register: 201 and the same body whether or not the email is taken', async () => {
    const body = (email: string) => ({
      email,
      password: 'Password123!',
      name: 'E2E',
      roleId: userRoleId,
    });
    same(await post('/auth/register', body(known)), await post('/auth/register', body(unknown())));
  });

  it.each([
    ['/auth/forgot-password', (email: string) => ({ email })],
    ['/auth/resend-otp', (email: string) => ({ email })],
    ['/auth/verify-email', (email: string) => ({ email, otp: '000000' })],
    [
      '/auth/reset-password',
      (email: string) => ({ email, otp: '000000', newPassword: 'NewPassword123!' }),
    ],
  ])('%s: same status and body for a known and an unknown email', async (url, body) => {
    same(await post(url, body(known)), await post(url, body(unknown())));
  });
});

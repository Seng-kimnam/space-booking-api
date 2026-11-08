import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { signToken } from '../../utils/auth-tokens';
import { deleteRows, insertPlace } from '../../utils/fixtures';

const N = 10; // equals the app's default pg pool size, so every request holds its own connection

describe('seats label uniqueness under concurrency (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let P: string;
  const seatIds: string[] = [];

  const send = (m: 'post' | 'patch', url: string, body: object) =>
    request(app.getHttpServer())
      [m](`/api/v1${url}`)
      .set('Authorization', `Bearer ${admin}`)
      .send(body);

  // Holds a row lock (`lockSql`) that the racing statements must wait on, fires the requests,
  // waits until all of them are blocked at the DB (proof they overlap), then releases them together.
  // Row locks, not LOCK TABLE, so suites running in parallel on `seats` are not blocked.
  async function race(
    lockSql: string,
    lockArgs: unknown[],
    fire: () => PromiseLike<request.Response>[],
  ) {
    // Own connections: the app pool is fully held by the blocked requests.
    const conn = () =>
      new Client({
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      });
    const gate = conn();
    const observer = conn();
    await Promise.all([gate.connect(), observer.connect()]);
    try {
      await gate.query('BEGIN');
      await gate.query(lockSql, lockArgs);
      // supertest requests are lazy thenables: Promise.resolve() is what actually sends them
      const racing = fire().map((r) => Promise.resolve(r));
      const deadline = Date.now() + 10_000;
      for (;;) {
        const {
          rows: [{ n }],
        } = await observer.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (n >= racing.length) break;
        if (Date.now() > deadline)
          throw new Error(`not all ${racing.length} requests arrived (${n})`);
        await new Promise((r) => setTimeout(r, 25));
      }
      await gate.query('COMMIT');
      return await Promise.all(racing);
    } finally {
      await Promise.all([gate.end(), observer.end()]);
    }
  }

  const statuses = (rs: request.Response[]) =>
    rs.map((r) => r.status).sort((a, b) => a - b);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    admin = await signToken(app, 'ADMIN');
    P = await insertPlace(ds);
    // warm the pool so all N connections are open before the race
    await Promise.all(Array.from({ length: N }, () => ds.query('SELECT 1')));
  });

  afterAll(async () => {
    await deleteRows(ds, 'seats', seatIds);
    await deleteRows(ds, 'places', [P]);
    await app.close();
  });

  it('create: N parallel POSTs with the same label -> one 201, rest 409', async () => {
    const label = `race-${randomUUID().slice(0, 8)}`;
    const rs = await race(
      // FOR UPDATE on the place blocks the FK check (FOR KEY SHARE) of every seat INSERT
      'SELECT 1 FROM places WHERE id = $1 FOR UPDATE',
      [P],
      () =>
        Array.from({ length: N }, () =>
          send('post', `/admin/places/${P}/seats`, { label }),
        ),
    );
    rs.forEach((r) => r.body.id && seatIds.push(r.body.id));
    expect(statuses(rs)).toEqual([201, ...Array(N - 1).fill(409)]);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM seats WHERE place_id = $1 AND label = $2 AND deleted_at IS NULL`,
      [P, label],
    );
    expect(n).toBe(1);
  });

  it('update: two seats PATCHed to the same new label -> one 200, one 409', async () => {
    const mk = async () => {
      const r = await send('post', `/admin/places/${P}/seats`, {
        label: `s-${randomUUID().slice(0, 8)}`,
      });
      seatIds.push(r.body.id);
      return r.body.id as string;
    };
    const [s1, s2] = [await mk(), await mk()];
    const label = `new-${randomUUID().slice(0, 8)}`;
    const rs = await race(
      'SELECT 1 FROM seats WHERE id = ANY($1) FOR UPDATE',
      [[s1, s2]],
      () =>
        [s1, s2].map((id) => send('patch', `/admin/seats/${id}`, { label })),
    );
    expect(statuses(rs)).toEqual([200, 409]);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM seats WHERE place_id = $1 AND label = $2 AND deleted_at IS NULL`,
      [P, label],
    );
    expect(n).toBe(1);
  });
});

import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { signToken } from '../../utils/auth-tokens';
import { deleteRows, insertArea, insertPlace } from '../../utils/fixtures';
import { Seat } from '../../../src/seats/entities/seat.entity';

const N = 10; // equals the app's default pg pool size, so every request holds its own connection

describe('seats label uniqueness under concurrency (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let P: string;
  let A: string;
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

  // Parks `PATCH /admin/seats/:id { areaId }` between its first read of the seat and its write:
  // an ACCESS EXCLUSIVE lock on `areas` blocks the area lookup that runs between the two.
  // `meanwhile` runs while the PATCH is parked, then the lock is released.
  // LOCK TABLE briefly blocks other suites that read `areas`; it is held only for `meanwhile`.
  async function parkUpdate(seatId: string, meanwhile: () => Promise<void>) {
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
      const {
        rows: [{ pid }],
      } = await gate.query('SELECT pg_backend_pid() AS pid');
      await gate.query('BEGIN');
      await gate.query('LOCK TABLE areas IN ACCESS EXCLUSIVE MODE');
      // supertest requests are lazy thenables: Promise.resolve() is what actually sends it
      const parked = Promise.resolve(
        send('patch', `/admin/seats/${seatId}`, { areaId: A }),
      );
      const deadline = Date.now() + 10_000;
      for (;;) {
        // Only sessions blocked by the gate itself count, not other suites' lock waits.
        const {
          rows: [{ n }],
        } = await observer.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
          [pid],
        );
        if (n >= 1) break;
        if (Date.now() > deadline) throw new Error('PATCH never parked');
        await new Promise((r) => setTimeout(r, 25));
      }
      await meanwhile();
      await gate.query('COMMIT');
      return await parked;
    } finally {
      await Promise.all([gate.end(), observer.end()]);
    }
  }

  const mkSeat = async (): Promise<string> => {
    const r = await send('post', `/admin/places/${P}/seats`, {
      label: `s-${randomUUID().slice(0, 8)}`,
    });
    seatIds.push(r.body.id);
    return r.body.id as string;
  };

  const statuses = (rs: request.Response[]) =>
    rs.map((r) => r.status).sort((a, b) => a - b);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    admin = await signToken(app, 'ADMIN');
    P = await insertPlace(ds);
    A = await insertArea(ds, P);
    // warm the pool so all N connections are open before the race
    await Promise.all(Array.from({ length: N }, () => ds.query('SELECT 1')));
  });

  afterAll(async () => {
    await deleteRows(ds, 'seats', seatIds);
    await deleteRows(ds, 'areas', [A]);
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

  it('update: a status change made while an area PATCH is in flight survives', async () => {
    const id = await mkSeat();
    const patch = await parkUpdate(id, async () => {
      const r = await send('patch', `/admin/seats/${id}/status`, {
        status: 'MAINTENANCE',
      });
      expect(r.status).toBe(200);
    });
    expect(patch.status).toBe(200);
    const [row] = await ds.query(
      `SELECT status, area_id FROM seats WHERE id = $1`,
      [id],
    );
    expect(row).toEqual({ status: 'MAINTENANCE', area_id: A });
  });

  it('update: a delete made while an area PATCH is in flight is not undone', async () => {
    const id = await mkSeat();
    const patch = await parkUpdate(id, async () => {
      const r = await request(app.getHttpServer())
        .delete(`/api/v1/admin/seats/${id}`)
        .set('Authorization', `Bearer ${admin}`);
      expect(r.status).toBe(204);
    });
    expect(patch.status).toBe(404);
    const [row] = await ds.query(
      `SELECT deleted_at IS NOT NULL AS deleted FROM seats WHERE id = $1`,
      [id],
    );
    expect(row.deleted).toBe(true);
  });

  // Injected at the repository boundary: setStatus runs no query between its read and its write that a DB lock could park, so the concurrent change is made right before the first write call.
  it('status: a label change made between the read and the write survives', async () => {
    const id = await mkSeat();
    const newLabel = `new-${randomUUID().slice(0, 8)}`;
    const repo = app.get<Repository<Seat>>(getRepositoryToken(Seat));
    const realSave = repo.save.bind(repo);
    const realUpdate = repo.update.bind(repo);
    let fired = false;
    const firstWrite = async <R>(run: () => Promise<R>): Promise<R> => {
      if (!fired) {
        fired = true;
        await ds.query('UPDATE seats SET label = $1 WHERE id = $2', [
          newLabel,
          id,
        ]);
      }
      return run();
    };
    const spySave = jest
      .spyOn(repo, 'save')
      .mockImplementation(
        (...args: Parameters<typeof realSave>) =>
          firstWrite(() => realSave(...args)),
      );
    const spyUpdate = jest
      .spyOn(repo, 'update')
      .mockImplementation(
        (...args: Parameters<typeof realUpdate>) =>
          firstWrite(() => realUpdate(...args)),
      );
    try {
      const r = await send('patch', `/admin/seats/${id}/status`, {
        status: 'MAINTENANCE',
      });
      expect(r.status).toBe(200);
    } finally {
      spySave.mockRestore();
      spyUpdate.mockRestore();
    }
    expect(fired).toBe(true);
    const [row] = await ds.query(
      `SELECT label, status FROM seats WHERE id = $1`,
      [id],
    );
    expect(row).toEqual({ label: newLabel, status: 'MAINTENANCE' });
  });
});

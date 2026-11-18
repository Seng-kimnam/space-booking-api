import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signToken } from '../../utils/auth-tokens';
import { createTestApp } from '../../utils/create-test-app';

/**
 * API clients over HTTP against a real Postgres: admin endpoints, and the
 * X-API-Key guard on an integration route (docs/integration/service-authentication.md §2.1).
 */
describe('API clients (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let user: string;
  const clientIds: string[] = [];
  const lmsPlaceId = `e2e-key-${Date.now().toString(36)}`;
  let sbPlaceId: string | undefined;

  const api = (m: 'post' | 'patch' | 'get', url: string, token?: string) => {
    const r = request(app.getHttpServer())[m](`/api/v1${url}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const statusUrl = () => `/integrations/library/places/${lmsPlaceId}`;
  const createClient = async (scopes: string[]) => {
    const res = await api('post', '/admin/api-clients', admin).send({
      name: `e2e-${randomUUID().slice(0, 8)}`,
      scopes,
    });
    if (res.body.id) clientIds.push(res.body.id);
    return res;
  };

  beforeAll(async () => {
    if (!process.env.DB_NAME?.endsWith('_test')) {
      throw new Error('Run against a dedicated *_test database: DB_NAME=..._test npm run test:e2e');
    }
    app = await createTestApp();
    ds = app.get(DataSource);
    admin = await signToken(app, 'ADMIN');
    user = await signToken(app, 'USER');
    // An LMS-managed place, as if a snapshot had been applied.
    [{ id: sbPlaceId }] = await ds.query(
      `INSERT INTO places (name, type, address, timezone, is_active, external_system, external_id, external_revision, external_open)
       VALUES ($1, 'LIBRARY', 'Test street', 'Asia/Phnom_Penh', true, 'library', $2, 7, true) RETURNING id`,
      [`e2e ${lmsPlaceId}`, lmsPlaceId],
    );
  });

  afterAll(async () => {
    if (clientIds.length) await ds.query('DELETE FROM api_clients WHERE id = ANY($1)', [clientIds]);
    if (sbPlaceId) await ds.query('DELETE FROM places WHERE id = $1', [sbPlaceId]);
    await app.close();
  });

  it('only ADMIN manages API clients', async () => {
    await api('get', '/admin/api-clients').expect(401);
    await api('get', '/admin/api-clients', user).expect(403);
    await api('get', '/admin/api-clients', admin).expect(200);
  });

  it('creates a client, returns the key once, and never returns the hash', async () => {
    const res = await createClient(['places:read']);
    expect(res.status).toBe(201);
    expect(res.body.apiKey).toMatch(/^sbk_test_/);
    expect(res.body).not.toHaveProperty('apiKeyHash');

    const got = await api('get', `/admin/api-clients/${res.body.id}`, admin).expect(200);
    expect(got.body).not.toHaveProperty('apiKey');
    expect(got.body).not.toHaveProperty('apiKeyHash');
    const [row] = await ds.query('SELECT api_key_hash FROM api_clients WHERE id = $1', [res.body.id]);
    expect(row.api_key_hash).not.toContain(res.body.apiKey.split('_').pop());
  });

  it('rejects unknown scopes and duplicate names', async () => {
    await createClientWith({ name: 'x', scopes: ['admin:all'] }).expect(400);
    const first = await createClient([]);
    await createClientWith({ name: first.body.name, scopes: [] }).expect(409);
  });

  function createClientWith(body: object) {
    return api('post', '/admin/api-clients', admin).send(body);
  }

  it('guards integration routes by key and scope', async () => {
    const reader = await createClient(['places:read']);
    const linker = await createClient(['identities:link']);

    await api('get', statusUrl()).expect(401);
    await api('get', statusUrl()).set('X-API-Key', 'sbk_test_garbage').expect(401);
    // A user's JWT is not an API key.
    await api('get', statusUrl(), user).expect(401);
    await api('get', statusUrl()).set('X-API-Key', linker.body.apiKey).expect(403);

    const ok = await api('get', statusUrl()).set('X-API-Key', reader.body.apiKey).expect(200);
    expect(ok.body).toMatchObject({ placeId: lmsPlaceId, revision: 7, sbPlaceId, bookingOpen: true, seats: [] });

    const [row] = await ds.query('SELECT last_used_at FROM api_clients WHERE id = $1', [reader.body.id]);
    expect(row.last_used_at).not.toBeNull();
  });

  it('rotating the key or deactivating the client cuts the old key off', async () => {
    const client = await createClient(['places:read']);
    const rotated = await api('post', `/admin/api-clients/${client.body.id}/rotate-key`, admin).expect(201);
    expect(rotated.body.apiKey).not.toBe(client.body.apiKey);
    await api('get', statusUrl()).set('X-API-Key', client.body.apiKey).expect(401);
    await api('get', statusUrl()).set('X-API-Key', rotated.body.apiKey).expect(200);

    await api('patch', `/admin/api-clients/${client.body.id}`, admin).send({ isActive: false }).expect(200);
    await api('get', statusUrl()).set('X-API-Key', rotated.body.apiKey).expect(401);
  });

  it('LMS-managed places refuse admin edits of LMS-owned fields but allow go-live', async () => {
    await api('patch', `/admin/places/${sbPlaceId}`, admin).send({ name: 'renamed' }).expect(409);
    await api('patch', `/admin/places/${sbPlaceId}`, admin).send({ isActive: false }).expect(200);
    const [reply] = await ds.query(
      `SELECT payload FROM outbox_events WHERE event_type = 'place.sync_applied' AND aggregate_id = $1`,
      [sbPlaceId],
    );
    expect(reply.payload).toMatchObject({ placeId: lmsPlaceId, revision: 7, bookingOpen: false });
    await ds.query('DELETE FROM outbox_events WHERE aggregate_id = $1', [sbPlaceId]);
  });

  it('admin resync answers 503 while LMS_BASE_URL is not configured', async () => {
    await api('post', `/admin/integrations/library/places/${lmsPlaceId}/resync`, admin).expect(503);
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { LibraryLinksService } from '../../../src/integrations/library/services/library-links.service';
import type { IncomingEnvelope } from '../../../src/messaging/consumers/consumer-route';
import { signToken } from '../../utils/auth-tokens';
import { createTestApp } from '../../utils/create-test-app';

/**
 * LMS account linking end to end (real Postgres): link request by API key,
 * confirmation by the user, identity.* outbox rows, member standing blocking
 * new bookings at LMS places, unlink by LMS.
 */
describe('LMS account linking (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let userToken: string;
  let userId: string;
  let apiKey: string;
  let clientId: string;
  let placeId: string;
  let seatId: string;
  const run = Date.now().toString(36);
  const memberId = `m-${run}`;

  const api = (m: 'post' | 'get' | 'delete', url: string) => request(app.getHttpServer())[m](`/api/v1${url}`);
  const outbox = (eventType: string): Promise<{ payload: Record<string, unknown> }[]> =>
    ds.query(`SELECT payload FROM outbox_events WHERE event_type = $1 AND payload->>'memberId' = $2 ORDER BY occurred_at`, [
      eventType,
      memberId,
    ]);
  const standing = (eligible: boolean, evaluatedAt: string) =>
    ds.transaction((m) =>
      app.get(LibraryLinksService).applyStanding(m, {
        data: {
          memberId,
          eligible,
          reasons: eligible ? [] : ['OVERDUE_ITEMS'],
          accountStatus: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          expiryDate: null,
          blockedUntil: null,
          evaluatedAt,
        },
      } as unknown as IncomingEnvelope),
    );
  const book = () => {
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setUTCHours(3, 0, 0, 0);
    return api('post', '/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ seatIds: [seatId], startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600_000).toISOString() });
  };

  beforeAll(async () => {
    if (!process.env.DB_NAME?.endsWith('_test')) {
      throw new Error('Run against a dedicated *_test database: DB_NAME=..._test npm run test:e2e');
    }
    app = await createTestApp();
    ds = app.get(DataSource);
    admin = await signToken(app, 'ADMIN');
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (name, email, role_id) VALUES ('Link e2e', $1, (SELECT id FROM roles WHERE name = 'USER')) RETURNING id`,
      [`link-${run}@example.test`],
    );
    userToken = await signToken(app, 'USER', userId);
    const client = await api('post', '/admin/api-clients')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: `lms-link-${run}`, scopes: ['identities:link'] })
      .expect(201);
    apiKey = client.body.apiKey;
    clientId = client.body.id;
    // A live LMS-managed place with one seat.
    [{ id: placeId }] = await ds.query(
      `INSERT INTO places (name, type, address, timezone, is_active, external_system, external_id, external_revision, external_open)
       VALUES ($1, 'LIBRARY', 'Test street', 'Asia/Phnom_Penh', true, 'library', $2, 1, true) RETURNING id`,
      [`link e2e ${run}`, `p-${run}`],
    );
    await ds.query('INSERT INTO booking_policies (place_id) VALUES ($1)', [placeId]);
    [{ id: seatId }] = await ds.query(
      `INSERT INTO seats (place_id, label, external_id) VALUES ($1, 'L-1', '1') RETURNING id`,
      [placeId],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM outbox_events WHERE payload->>'memberId' = $1`, [memberId]);
      await ds.query(`DELETE FROM external_link_requests WHERE external_user_id = $1`, [memberId]);
      await ds.query(`DELETE FROM external_identities WHERE external_user_id = $1`, [memberId]);
      await ds.query('DELETE FROM seats WHERE place_id = $1', [placeId]);
      await ds.query('DELETE FROM booking_policies WHERE place_id = $1', [placeId]);
      await ds.query('DELETE FROM places WHERE id = $1', [placeId]);
      await ds.query('DELETE FROM api_clients WHERE id = $1', [clientId]);
      await ds.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await app?.close();
  });

  it('links a member with a one-time code and publishes identity.linked', async () => {
    await api('post', '/integrations/library/link-requests').send({ memberId }).expect(401);
    const req = await api('post', '/integrations/library/link-requests')
      .set('X-API-Key', apiKey)
      .send({ memberId })
      .expect(201);
    expect(req.body.code).toHaveLength(32);

    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM external_link_requests WHERE code_hash = encode(sha256($1::bytea), 'hex')`,
      [req.body.code],
    );
    expect(count).toBe(1); // stored as a hash only

    const linked = await api('post', '/integrations/library/my-link')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ code: req.body.code })
      .expect(201);
    expect(linked.body).toMatchObject({ system: 'library', memberId, eligible: null });

    // Single use.
    await api('post', '/integrations/library/my-link')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ code: req.body.code })
      .expect(400);

    const [event] = await outbox('identity.linked');
    expect(event.payload).toMatchObject({ system: 'library', memberId, linked: true });
    expect(JSON.stringify(event.payload)).not.toContain(userId);
  });

  it('blocks new bookings at LMS places while LMS says the member is not eligible', async () => {
    expect(await standing(false, '2026-11-11T00:00:00.000Z')).toBeUndefined();
    const blocked = await book();
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toContain('OVERDUE_ITEMS');

    // An older standing must not undo the newer one.
    await standing(true, '2026-11-10T00:00:00.000Z');
    expect((await book()).status).toBe(403);

    await standing(true, '2026-11-12T00:00:00.000Z');
    expect((await book()).status).not.toBe(403);
  });

  it('LMS can unlink; identity.unlinked is published and the link is gone', async () => {
    await api('delete', `/integrations/library/links/${memberId}`).set('X-API-Key', apiKey).expect(204);
    await api('delete', `/integrations/library/links/${memberId}`).set('X-API-Key', apiKey).expect(404);
    await api('get', '/integrations/library/my-link').set('Authorization', `Bearer ${userToken}`).expect(404);
    const [event] = await outbox('identity.unlinked');
    expect(event.payload).toMatchObject({ memberId, linked: false });
  });

  it('a code requested for one member cannot be reused after a newer one', async () => {
    const first = await api('post', '/integrations/library/link-requests').set('X-API-Key', apiKey).send({ memberId });
    const second = await api('post', '/integrations/library/link-requests').set('X-API-Key', apiKey).send({ memberId });
    await api('post', '/integrations/library/my-link')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ code: first.body.code })
      .expect(400);
    await api('post', '/integrations/library/my-link')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ code: second.body.code })
      .expect(201);
  });
});

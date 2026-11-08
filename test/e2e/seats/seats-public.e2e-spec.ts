import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { deleteRows, insertArea, insertPlace } from '../../utils/fixtures';

const KEYS = [
  'areaId',
  'createdAt',
  'features',
  'id',
  'label',
  'placeId',
  'status',
  'updatedAt',
];

describe('seats public reads (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const seatIds: string[] = [];
  const areaIds: string[] = [];
  const placeIds: string[] = [];
  let P: string;
  let A: string;
  let s1: string;
  let s2: string;
  let s3: string;
  let deletedSeat: string;
  let inactivePlace: string;
  let inactiveSeat: string;
  let deletedPlace: string;
  let deletedPlaceSeat: string;

  const seat = async (
    placeId: string,
    label: string,
    extra = '',
    areaId: string | null = null,
  ) => {
    const [row] = await ds.query(
      `INSERT INTO seats (place_id, area_id, label${extra ? ', ' + extra.split('=')[0] : ''})
       VALUES ($1, $2, $3${extra ? ", '" + extra.split('=')[1] + "'" : ''}) RETURNING id`,
      [placeId, areaId, label],
    );
    seatIds.push(row.id);
    return row.id as string;
  };
  const place = async () => {
    const id = await insertPlace(ds);
    placeIds.push(id);
    return id;
  };
  const get = (url: string) =>
    request(app.getHttpServer()).get(`/api/v1${url}`);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    P = await place();
    A = await insertArea(ds, P);
    areaIds.push(A);
    s1 = await seat(P, 'B2');
    s2 = await seat(P, 'A1', 'status=MAINTENANCE', A);
    s3 = await seat(P, 'C3');
    deletedSeat = await seat(P, 'D4');
    await ds.query(`UPDATE seats SET deleted_at = now() WHERE id = $1`, [
      deletedSeat,
    ]);
    inactivePlace = await place();
    await ds.query(`UPDATE places SET is_active = false WHERE id = $1`, [
      inactivePlace,
    ]);
    inactiveSeat = await seat(inactivePlace, 'X1');
    deletedPlace = await place();
    deletedPlaceSeat = await seat(deletedPlace, 'X1');
    await ds.query(`UPDATE places SET deleted_at = now() WHERE id = $1`, [
      deletedPlace,
    ]);
  });

  afterAll(async () => {
    try {
      await deleteRows(ds, 'seats', seatIds);
      await deleteRows(ds, 'areas', areaIds);
      await deleteRows(ds, 'places', placeIds);
    } finally {
      await app.close();
    }
  });

  it('lists only live seats of a place, ordered by label, with exact keys', async () => {
    const res = await get(`/seats?placeId=${P}`).expect(200);
    expect(res.body.items.map((i: { label: string }) => i.label)).toEqual([
      'A1',
      'B2',
      'C3',
    ]);
    expect(res.body.total).toBe(3);
    for (const item of res.body.items)
      expect(Object.keys(item).sort()).toEqual(KEYS);
  });

  it('paginates', async () => {
    const res = await get(`/seats?placeId=${P}&limit=2&page=2`).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body).toMatchObject({ total: 3, page: 2, limit: 2 });
  });

  it.each([
    'limit=101',
    'limit=0',
    'page=0',
    'placeId=abc',
    'status=BROKEN',
    'foo=1',
  ])('rejects %s with 400', async (q) => {
    const res = await get(`/seats?${q}`).expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    expect(res.body.message).toBeDefined();
  });

  it('filters by status and area', async () => {
    const byStatus = await get(`/seats?placeId=${P}&status=MAINTENANCE`).expect(
      200,
    );
    expect(byStatus.body.items.map((i: { id: string }) => i.id)).toEqual([s2]);
    const byArea = await get(`/seats?placeId=${P}&areaId=${A}`).expect(200);
    expect(byArea.body.items.map((i: { id: string }) => i.id)).toEqual([s2]);
  });

  it('hides soft-deleted seats', async () => {
    await get(`/seats/${deletedSeat}`).expect(404);
    const res = await get(`/seats?placeId=${P}`).expect(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).not.toContain(
      deletedSeat,
    );
  });

  it('hides seats of inactive and deleted places', async () => {
    for (const [p, s] of [
      [inactivePlace, inactiveSeat],
      [deletedPlace, deletedPlaceSeat],
    ]) {
      const res = await get(`/seats?placeId=${p}`).expect(200);
      expect(res.body.total).toBe(0);
      await get(`/seats/${s}`).expect(404);
      await get(`/places/${p}/seats`).expect(404);
    }
  });

  it('returns 404 for unknown id and 400 for non-uuid', async () => {
    await get(`/seats/${randomUUID()}`).expect(404);
    await get('/seats/abc').expect(400);
    const ok = await get(`/seats/${s1}`).expect(200);
    expect(Object.keys(ok.body).sort()).toEqual(KEYS);
  });

  it('GET /places/:id/seats lists, filters and rejects placeId', async () => {
    const all = await get(`/places/${P}/seats`).expect(200);
    expect(all.body.items.map((i: { id: string }) => i.id)).toEqual([
      s2,
      s1,
      s3,
    ]);
    const byArea = await get(`/places/${P}/seats?areaId=${A}`).expect(200);
    expect(byArea.body.total).toBe(1);
    await get(`/places/${P}/seats?placeId=${P}`).expect(400);
    await get(`/places/${randomUUID()}/seats`).expect(404);
  });
});

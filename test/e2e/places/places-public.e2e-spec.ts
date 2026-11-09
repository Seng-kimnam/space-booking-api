import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { deleteRows } from '../../utils/fixtures';

describe('places public reads (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const placeIds: string[] = [];
  // Every place in this suite has the tag in its name, so searches ignore other rows.
  const tag = `pub${randomUUID().slice(0, 8)}`;
  let LIB: string;
  let CAFE: string;
  let INACTIVE: string;
  let DELETED: string;

  const get = (url: string) =>
    request(app.getHttpServer()).get(`/api/v1${url}`);

  async function place(
    name: string,
    type: string,
    extra: { active?: boolean; deleted?: boolean } = {},
  ) {
    const [{ id }] = await ds.query(
      `INSERT INTO places (name, type, address, is_active, deleted_at)
       VALUES ($1, $2, 'addr', $3, CASE WHEN $4 THEN now() END) RETURNING id`,
      [name, type, extra.active ?? true, extra.deleted ?? false],
    );
    placeIds.push(id);
    return id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    LIB = await place(`${tag} Alpha Library`, 'LIBRARY');
    CAFE = await place(`${tag} Beta Cafe 100%`, 'CAFE');
    INACTIVE = await place(`${tag} Gamma Hidden`, 'LIBRARY', { active: false });
    DELETED = await place(`${tag} Delta Gone`, 'LIBRARY', { deleted: true });

    await ds.query(
      `INSERT INTO booking_policies (place_id, checkin_grace_minutes) VALUES ($1, 10)`,
      [LIB],
    );
    await ds.query(
      `INSERT INTO place_opening_hours (place_id, weekday, open_time, close_time)
       VALUES ($1, 3, '08:00', '18:00'), ($1, 1, '07:00', '21:00')`,
      [LIB],
    );
    await ds.query(
      `INSERT INTO place_closures (place_id, date, reason)
       VALUES ($1, '2000-01-01', 'past'), ($1, '2999-12-31', 'future')`,
      [LIB],
    );
  });

  afterAll(async () => {
    await deleteRows(ds, 'places', placeIds);
    await app.close();
  });

  describe('GET /places', () => {
    it('lists only active, non-deleted places, sorted by name', async () => {
      const res = await get(`/places?search=${tag}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 2 });
      expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([
        LIB,
        CAFE,
      ]);
    });

    it('returns only public fields', async () => {
      const res = await get(`/places?search=${tag}&type=LIBRARY`);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(
        [
          'address',
          'createdAt',
          'description',
          'id',
          'isActive',
          'lat',
          'lng',
          'name',
          'timezone',
          'type',
          'updatedAt',
        ].sort(),
      );
    });

    it('filters by type', async () => {
      const res = await get(`/places?search=${tag}&type=CAFE`);
      expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([CAFE]);
    });

    it('searches case-insensitively and treats % literally', async () => {
      const upper = await get(`/places?search=${tag.toUpperCase()}%20alpha`);
      expect(upper.body.items.map((p: { id: string }) => p.id)).toEqual([LIB]);
      const pct = await get(
        `/places?search=${encodeURIComponent(`${tag} Beta Cafe 100%`)}`,
      );
      expect(pct.body.items.map((p: { id: string }) => p.id)).toEqual([CAFE]);
      const wildcard = await get(
        `/places?search=${encodeURIComponent(`${tag}%Library`)}`,
      );
      expect(wildcard.body.total).toBe(0);
    });

    it('paginates', async () => {
      const res = await get(`/places?search=${tag}&page=2&limit=1`);
      expect(res.body).toMatchObject({ page: 2, limit: 1, total: 2 });
      expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([CAFE]);
    });

    it.each(['limit=101', 'page=0', 'type=LAB', 'bogus=1', 'search='])(
      '400 for ?%s',
      async (qs) => {
        expect((await get(`/places?${qs}`)).status).toBe(400);
      },
    );
  });

  describe('GET /places/:placeId', () => {
    it('returns details with sorted hours, upcoming closures and policy', async () => {
      const res = await get(`/places/${LIB}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: LIB,
        type: 'LIBRARY',
        timezone: 'Asia/Phnom_Penh',
        isActive: true,
        openingHours: [
          {
            weekday: 1,
            openTime: '07:00:00',
            closeTime: '21:00:00',
            closesNextDay: false,
          },
          {
            weekday: 3,
            openTime: '08:00:00',
            closeTime: '18:00:00',
            closesNextDay: false,
          },
        ],
        closures: [{ date: '2999-12-31', reason: 'future' }],
        bookingPolicy: {
          checkinGraceMinutes: 10,
          minMinutes: 30,
          maxMinutes: 240,
        },
      });
      expect(res.body).not.toHaveProperty('deletedAt');
    });

    it('returns empty hours/closures and a null policy when none exist', async () => {
      const res = await get(`/places/${CAFE}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        openingHours: [],
        closures: [],
        bookingPolicy: null,
      });
    });

    it('404s for inactive, deleted and unknown places', async () => {
      for (const id of [INACTIVE, DELETED, randomUUID()])
        expect((await get(`/places/${id}`)).status).toBe(404);
    });

    it('400s for a non-UUID id', async () => {
      expect((await get('/places/not-a-uuid')).status).toBe(400);
    });
  });
});

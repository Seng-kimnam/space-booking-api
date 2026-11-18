import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../src/app.module';
import { Seat } from '../../../src/seats/entities/seat.entity';
import { deleteRows, insertArea, insertPlace } from '../../utils/fixtures';

describe('seats schema (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const seatIds: string[] = [];
  const areaIds: string[] = [];
  const placeIds: string[] = [];

  const place = async () => {
    const id = await insertPlace(ds);
    placeIds.push(id);
    return id;
  };
  const area = async (placeId: string) => {
    const id = await insertArea(ds, placeId);
    areaIds.push(id);
    return id;
  };
  const seat = async (
    placeId: string,
    label: string,
    areaId: string | null = null,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO seats (place_id, area_id, label) VALUES ($1, $2, $3) RETURNING id`,
      [placeId, areaId, label],
    );
    seatIds.push(row.id);
    return row.id;
  };
  // Resolves with the Postgres error so tests can assert code + constraint.
  const pgError = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { driverError: { code: string; constraint?: string } })
        .driverError;
    }
    throw new Error('expected the query to fail');
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    // Children first: seats -> areas -> places (all FKs are RESTRICT).
    try {
      await deleteRows(ds, 'seats', seatIds);
      await deleteRows(ds, 'areas', areaIds);
      await deleteRows(ds, 'places', placeIds);
    } finally {
      await app.close();
    }
  });

  it('1. rejects two live seats with the same label in one place', async () => {
    const p = await place();
    await seat(p, 'A1');
    const err = await pgError(seat(p, 'A1'));
    expect(err).toMatchObject({
      code: '23505',
      constraint: 'seats_place_label_uk',
    });
  });

  it('2. allows reusing a label after soft delete', async () => {
    const p = await place();
    const id = await seat(p, 'A1');
    await ds.query(`UPDATE seats SET deleted_at = now() WHERE id = $1`, [id]);
    await expect(seat(p, 'A1')).resolves.toEqual(expect.any(String));
  });

  it('3. allows the same label in different places', async () => {
    await seat(await place(), 'A1');
    await expect(seat(await place(), 'A1')).resolves.toEqual(
      expect.any(String),
    );
  });

  it('4. rejects an area from another place', async () => {
    const p1 = await place();
    const p2 = await place();
    const otherArea = await area(p2);
    const err = await pgError(seat(p1, 'A1', otherArea));
    expect(err).toMatchObject({
      code: '23503',
      constraint: 'seats_area_same_place_fk',
    });
  });

  it('5. allows a NULL area and applies defaults', async () => {
    const id = await seat(await place(), 'A1', null);
    const [row] = await ds.query(
      `SELECT area_id, status, features FROM seats WHERE id = $1`,
      [id],
    );
    expect(row).toEqual({ area_id: null, status: 'ACTIVE', features: {} });
  });

  it('6. rejects an unknown status', async () => {
    const p = await place();
    const err = await pgError(
      ds.query(
        `INSERT INTO seats (place_id, label, status) VALUES ($1, 'A1', 'BROKEN')`,
        [p],
      ),
    );
    expect(err.code).toBe('22P02');
  });

  it('7. raw UPDATE advances updated_at (trigger)', async () => {
    const id = await seat(await place(), 'A1');
    await ds.query(`UPDATE seats SET label = 'A2' WHERE id = $1`, [id]);
    // Without the trigger a raw UPDATE leaves updated_at equal to created_at.
    const [row] = await ds.query(
      `SELECT updated_at > created_at AS advanced FROM seats WHERE id = $1`,
      [id],
    );
    expect(row.advanced).toBe(true);
  });

  it('8. cannot delete a place that still has a seat', async () => {
    const p = await place();
    await seat(p, 'A1');
    const err = await pgError(
      ds.query(`DELETE FROM places WHERE id = $1`, [p]),
    );
    expect(err).toMatchObject({
      code: '23503',
      constraint: 'seats_place_id_fkey',
    });
  });

  it('9. entity save keeps placeId and areaId', async () => {
    const p = await place();
    const a = await area(p);
    const saved = await ds
      .getRepository(Seat)
      .save({ placeId: p, areaId: a, label: `L-${randomUUID().slice(0, 8)}` });
    seatIds.push(saved.id);
    const reloaded = await ds
      .getRepository(Seat)
      .findOneByOrFail({ id: saved.id });
    expect(reloaded.placeId).toBe(p);
    expect(reloaded.areaId).toBe(a);
  });

  it('10. GIN index on features exists', async () => {
    const rows = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'seats_features_gin_idx'`,
    );
    expect(rows[0].indexdef).toContain('USING gin (features)');
  });
});

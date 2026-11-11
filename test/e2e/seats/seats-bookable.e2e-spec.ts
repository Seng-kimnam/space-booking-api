import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { deleteRows, insertPlace } from '../../utils/fixtures';
import { SeatsService } from '../../../src/seats/services/seats.service';

// Seats are inserted by raw SQL so each one gets exactly the status the case needs.
// label is varchar(30): prefix + 12 hex chars stays under the limit.
const uniq = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;

const insertSeat = async (
  ds: DataSource,
  placeId: string,
  label: string,
  status = 'ACTIVE',
) => {
  const [row] = await ds.query(
    `INSERT INTO seats (place_id, label, status) VALUES ($1, $2, $3) RETURNING id`,
    [placeId, label, status],
  );
  return row.id as string;
};

describe('SeatsService.findBookable (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let seatsService: SeatsService;
  const seatIds: string[] = [];
  const placeIds: string[] = [];
  let P: string;
  let active: string;
  let activeLabel: string;
  let maint: string;
  let unavailable: string;
  let deleted: string;
  let inInactive: string;
  let inDeleted: string;

  const place = async () => {
    const id = await insertPlace(ds);
    placeIds.push(id);
    return id;
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    seatsService = app.get(SeatsService);
    P = await place();
    activeLabel = uniq('seat-active');
    active = await insertSeat(ds, P, activeLabel);
    maint = await insertSeat(ds, P, uniq('seat-maint'), 'MAINTENANCE');
    unavailable = await insertSeat(
      ds,
      P,
      uniq('seat-unavailable'),
      'UNAVAILABLE',
    );
    deleted = await insertSeat(ds, P, uniq('seat-deleted'));
    await ds.query(`UPDATE seats SET deleted_at = now() WHERE id = $1`, [
      deleted,
    ]);
    const inactivePlace = await place();
    await ds.query(`UPDATE places SET is_active = false WHERE id = $1`, [
      inactivePlace,
    ]);
    inInactive = await insertSeat(ds, inactivePlace, uniq('seat-in-inactive'));
    const deletedPlace = await place();
    inDeleted = await insertSeat(ds, deletedPlace, uniq('seat-in-deleted'));
    await ds.query(`UPDATE places SET deleted_at = now() WHERE id = $1`, [
      deletedPlace,
    ]);
    seatIds.push(active, maint, unavailable, deleted, inInactive, inDeleted);
  });

  afterAll(async () => {
    try {
      await deleteRows(ds, 'seats', seatIds);
      await deleteRows(ds, 'places', placeIds);
    } finally {
      await app.close();
    }
  });

  it('returns only ACTIVE seats of visible places, with id, placeId and label', async () => {
    const result = await seatsService.findBookable([
      active,
      maint,
      unavailable,
      deleted,
      inInactive,
      inDeleted,
      randomUUID(),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: active,
      placeId: P,
      label: activeLabel,
    });
  });

  it('returns [] for an empty list', async () => {
    await expect(seatsService.findBookable([])).resolves.toEqual([]);
  });

  it('reads through the caller transaction when a manager is passed', async () => {
    const sentinel = new Error('rollback');
    let inside: { id: string; placeId: string; label: string }[] = [];
    let outside: { id: string; placeId: string; label: string }[] = [];
    let txId = '';
    try {
      await ds.transaction(async (m: EntityManager) => {
        const [row] = await m.query(
          `INSERT INTO seats (place_id, label, status) VALUES ($1, $2, $3) RETURNING id`,
          [P, uniq('seat-tx'), 'ACTIVE'],
        );
        txId = row.id;
        seatIds.push(txId);
        inside = await seatsService.findBookable([txId], m);
        outside = await seatsService.findBookable([txId]);
        throw sentinel;
      });
    } catch (err) {
      if (err !== sentinel) throw err;
    }
    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(0);
    const [row] = await ds.query(
      `SELECT count(*)::int AS n FROM seats WHERE id = $1`,
      [txId],
    );
    expect(row.n).toBe(0);
  });
});

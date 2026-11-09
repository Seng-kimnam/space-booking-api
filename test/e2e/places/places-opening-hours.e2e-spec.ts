import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { OpeningHoursService } from '../../../src/places/services/opening-hours.service';
import { createTestApp } from '../../utils/create-test-app';
import { deleteRows } from '../../utils/fixtures';

// 2026-01-05 is a Monday. Asia/Phnom_Penh is UTC+7 all year, so local = UTC + 7h.
describe('OpeningHoursService.isOpenForRange (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let svc: OpeningHoursService;
  const placeIds: string[] = [];
  let PP: string; // Asia/Phnom_Penh
  let UTC: string; // UTC, same Monday hours
  let NY: string; // America/New_York, has DST

  async function place(
    timezone: string,
    hours: [number, string, string, boolean?][],
    closures: string[] = [],
  ): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO places (name, type, address, timezone)
       VALUES ($1, 'LIBRARY', 'x', $2) RETURNING id`,
      [`oh-${randomUUID()}`, timezone],
    );
    placeIds.push(id);
    for (const [weekday, open, close, nextDay] of hours)
      await ds.query(
        `INSERT INTO place_opening_hours (place_id, weekday, open_time, close_time, closes_next_day)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, weekday, open, close, nextDay ?? false],
      );
    for (const date of closures)
      await ds.query(
        `INSERT INTO place_closures (place_id, date) VALUES ($1, $2)`,
        [id, date],
      );
    return id;
  }

  const open = (placeId: string, startIso: string, endIso: string) =>
    svc.isOpenForRange(placeId, new Date(startIso), new Date(endIso));

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    svc = app.get(OpeningHoursService);
    PP = await place(
      'Asia/Phnom_Penh',
      [
        [1, '07:00', '21:00'], // Mon
        [2, '00:00', '00:00', true], // Tue: all day
        [3, '00:00', '12:00'], // Wed morning (touches Tue's window)
        [5, '18:00', '02:00', true], // Fri overnight into Sat
        [6, '10:00', '12:00'], // Sat
        // Sun and Thu: closed
      ],
      ['2026-01-12'], // the next Monday
    );
    UTC = await place('UTC', [[1, '07:00', '21:00']]);
    NY = await place('America/New_York', [[1, '09:00', '17:00']]);
  });

  afterAll(async () => {
    await deleteRows(ds, 'places', placeIds);
    await app.close();
  });

  it.each([
    [
      'inside Monday hours',
      '2026-01-05T02:00:00Z',
      '2026-01-05T04:00:00Z',
      true,
    ],
    [
      'ending exactly at close',
      '2026-01-05T13:00:00Z',
      '2026-01-05T14:00:00Z',
      true,
    ],
    [
      'starting exactly at open',
      '2026-01-05T00:00:00Z',
      '2026-01-05T01:00:00Z',
      true,
    ],
    [
      'starting before open',
      '2026-01-04T23:30:00Z',
      '2026-01-05T01:00:00Z',
      false,
    ],
    [
      'running past close',
      '2026-01-05T13:30:00Z',
      '2026-01-05T14:30:00Z',
      false,
    ],
    [
      'on a closed weekday (Sunday)',
      '2026-01-04T03:00:00Z',
      '2026-01-04T05:00:00Z',
      false,
    ],
    [
      'across midnight inside the Friday overnight window',
      '2026-01-09T16:00:00Z',
      '2026-01-09T18:00:00Z',
      true,
    ],
    [
      'spilling past the overnight close',
      '2026-01-09T18:30:00Z',
      '2026-01-09T19:30:00Z',
      false,
    ],
    [
      'across days where windows touch (Tue all day -> Wed morning)',
      '2026-01-06T15:00:00Z',
      '2026-01-06T19:00:00Z',
      true,
    ],
    [
      'on a closure date',
      '2026-01-12T02:00:00Z',
      '2026-01-12T04:00:00Z',
      false,
    ],
    [
      'the Monday after the closure',
      '2026-01-19T02:00:00Z',
      '2026-01-19T04:00:00Z',
      true,
    ],
  ])('Phnom Penh: %s -> %s', async (_, s, e, expected) => {
    expect(await open(PP, s, e)).toBe(expected);
  });

  it('evaluates hours in the place timezone, not UTC', async () => {
    // 09:00-11:00 in Phnom Penh is 02:00-04:00 UTC: before a UTC place opens.
    expect(
      await open(UTC, '2026-01-05T02:00:00Z', '2026-01-05T04:00:00Z'),
    ).toBe(false);
    expect(
      await open(UTC, '2026-01-05T09:00:00Z', '2026-01-05T11:00:00Z'),
    ).toBe(true);
  });

  it('follows daylight saving time', async () => {
    // New York opens 09:00 local: 13:00Z in July (EDT, UTC-4), 14:00Z in January (EST, UTC-5).
    expect(await open(NY, '2026-07-06T13:00:00Z', '2026-07-06T15:00:00Z')).toBe(
      true,
    );
    expect(await open(NY, '2026-01-05T13:00:00Z', '2026-01-05T15:00:00Z')).toBe(
      false,
    );
    expect(await open(NY, '2026-01-05T14:00:00Z', '2026-01-05T16:00:00Z')).toBe(
      true,
    );
  });

  it('is closed for inactive, deleted and unknown places', async () => {
    const range = ['2026-01-05T02:00:00Z', '2026-01-05T04:00:00Z'] as const;
    const inactive = await place('Asia/Phnom_Penh', [[1, '07:00', '21:00']]);
    await ds.query(`UPDATE places SET is_active = false WHERE id = $1`, [
      inactive,
    ]);
    const deleted = await place('Asia/Phnom_Penh', [[1, '07:00', '21:00']]);
    await ds.query(`UPDATE places SET deleted_at = now() WHERE id = $1`, [
      deleted,
    ]);

    expect(await open(inactive, ...range)).toBe(false);
    expect(await open(deleted, ...range)).toBe(false);
    expect(await open(randomUUID(), ...range)).toBe(false);
  });
});

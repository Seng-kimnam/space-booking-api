import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlaceSnapshotV1 } from '../../../messaging/contract/types';
import { checkSnapshot } from './place-snapshot.rules';

const base = (): PlaceSnapshotV1 =>
  (
    JSON.parse(
      readFileSync(join(__dirname, '../../../../docs/integration/fixtures/place.updated.v1.json'), 'utf-8'),
    ) as { body: { data: PlaceSnapshotV1 } }
  ).body.data;

describe('checkSnapshot', () => {
  it('accepts the example snapshot', () => {
    expect(checkSnapshot(base())).toBeNull();
  });

  it.each<[string, (s: PlaceSnapshotV1) => void, string]>([
    ['unknown time zone', (s) => (s.timezone = 'Mars/Olympus'), 'INVALID_TIMEZONE'],
    ['duplicate weekday', (s) => s.openingHours.push({ ...s.openingHours[0] }), 'INVALID_OPENING_HOURS'],
    ['close before open', (s) => (s.openingHours[0] = { weekday: 1, open: '20:00', close: '08:00', closesNextDay: false }), 'INVALID_OPENING_HOURS'],
    ['impossible date', (s) => (s.closures = [{ date: '2026-02-30', reason: null }]), 'INVALID_CLOSURES'],
    ['duplicate closure', (s) => s.closures.push({ ...s.closures[0] }), 'INVALID_CLOSURES'],
    ['duplicate seat id', (s) => s.seats.push({ ...s.seats[0], label: 'X-1' }), 'DUPLICATE_ID'],
    ['duplicate label', (s) => s.seats.push({ ...s.seats[0], seatId: '999' }), 'SEAT_LABEL_CONFLICT'],
    ['duplicate area name', (s) => s.areas.push({ ...s.areas[0], areaId: '999' }), 'AREA_NAME_CONFLICT'],
    ['seat in an unknown area', (s) => (s.seats[0].areaId = '404'), 'UNKNOWN_AREA'],
    ['reserved label prefix', (s) => (s.seats[0].label = '~sync~1'), 'SEAT_LABEL_CONFLICT'],
  ])('rejects %s', (_, mutate, code) => {
    const s = base();
    mutate(s);
    const result = checkSnapshot(s);
    expect(result?.code).toBe(code);
    expect(result?.details[0].path).toBeTruthy();
  });

  it('accepts an overnight window that closes at or before it opens', () => {
    const s = base();
    s.openingHours = [{ weekday: 5, open: '18:00', close: '02:00', closesNextDay: true }];
    expect(checkSnapshot(s)).toBeNull();
  });
});

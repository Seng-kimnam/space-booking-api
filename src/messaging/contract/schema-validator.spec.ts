import { PoisonMessageError, SchemaValidator } from './schema-validator';

const snapshot = () => ({
  placeId: '1',
  code: 'MAIN',
  revision: 42,
  name: 'LibraFlow Main Library',
  description: null,
  address: 'Street 1, Phnom Penh',
  lat: 11.5564,
  lng: 104.9282,
  timezone: 'Asia/Phnom_Penh',
  status: 'ACTIVE',
  bookingEnabled: true,
  openingHours: [{ weekday: 1, open: '08:00', close: '20:00', closesNextDay: false }],
  closures: [{ date: '2026-12-25', reason: 'Public holiday' }],
  areas: [{ areaId: '3', name: 'Reading Room', floor: '2', type: 'READING_ROOM', description: null, status: 'ACTIVE' }],
  seats: [{ seatId: '57', areaId: '3', label: 'RR-12', features: { power: true }, status: 'ACTIVE' }],
});

describe('SchemaValidator', () => {
  const v = new SchemaValidator();

  it('accepts a valid place snapshot and ignores unknown fields', () => {
    expect(() => v.assertData('place.updated', 1, { ...snapshot(), extra: 'ignored' })).not.toThrow();
  });

  it.each([
    ['missing field', (s: Record<string, unknown>) => delete s.revision],
    ['bad time', (s: Record<string, unknown>) => ((s.openingHours as object[])[0] = { weekday: 1, open: '8am', close: '20:00', closesNextDay: false })],
    ['nested feature object', (s: Record<string, unknown>) => ((s.seats as { features: unknown }[])[0].features = { a: { b: 1 } })],
    ['unknown seat status', (s: Record<string, unknown>) => ((s.seats as { status: string }[])[0].status = 'BROKEN')],
  ])('rejects a snapshot with a %s as poison', (_, mutate) => {
    const s = snapshot() as Record<string, unknown>;
    mutate(s);
    expect(() => v.assertData('place.updated', 1, s)).toThrow(PoisonMessageError);
  });

  it('rejects types or versions outside the contract', () => {
    expect(v.knows('place.updated', 1)).toBe(true);
    expect(v.knows('place.updated', 2)).toBe(false);
    expect(() => v.assertData('place.updated', 2, snapshot())).toThrow('not in the contract');
  });

  it('validates the envelope', () => {
    const env = {
      id: '0b8f5a8e-6a0f-4f0a-9c51-2b1f0e7d9a10',
      type: 'place.updated',
      version: 1,
      source: 'library',
      occurredAt: '2026-11-09T10:15:00.000Z',
      correlationId: null,
      subject: { type: 'place', id: '1' },
      data: {},
    };
    expect(() => v.assertEnvelope(env)).not.toThrow();
    expect(() => v.assertEnvelope({ ...env, id: 'nope' })).toThrow(PoisonMessageError);
  });
});

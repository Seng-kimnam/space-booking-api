import type { EntityManager } from 'typeorm';
import { SchemaValidator } from '../contract/schema-validator';
import { ContractViolationError, OutboxService } from './outbox.service';

const syncApplied = {
  schemaVersion: 1,
  placeId: '1',
  revision: 3,
  sbPlaceId: '1b7d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e3f',
  bookingOpen: false,
  seats: [],
  cancelledBookings: 0,
};

function setup() {
  const inserted: unknown[] = [];
  const manager = {
    getRepository: () => ({ insert: async (row: unknown) => inserted.push(row) }),
  } as unknown as EntityManager;
  return { svc: new OutboxService(new SchemaValidator()), manager, inserted };
}

describe('OutboxService contract enforcement', () => {
  it('writes a payload that matches its schema', async () => {
    const { svc, manager, inserted } = setup();
    await svc.add(manager, {
      aggregateType: 'place',
      aggregateId: syncApplied.sbPlaceId,
      eventType: 'place.sync_applied',
      payload: syncApplied,
    });
    expect(inserted).toHaveLength(1);
  });

  it('refuses a payload that breaks the schema, writing nothing', async () => {
    const { svc, manager, inserted } = setup();
    const bad = { ...syncApplied, revision: 'three' } as unknown as typeof syncApplied;
    await expect(
      svc.add(manager, { aggregateType: 'place', aggregateId: 'x', eventType: 'place.sync_applied', payload: bad }),
    ).rejects.toThrow(ContractViolationError);
    expect(inserted).toHaveLength(0);
  });

  it('refuses routing keys we do not publish', async () => {
    const { svc, manager } = setup();
    await expect(
      svc.add(manager, {
        aggregateType: 'place',
        aggregateId: 'x',
        eventType: 'place.updated' as never,
        payload: syncApplied as never,
      }),
    ).rejects.toThrow('not a message Space Booking publishes');
  });
});

import type { EntityManager } from 'typeorm';
import { BookingEventType, BookingSource, BookingStatus } from '../../common/enums';
import { SchemaValidator } from '../../messaging/contract/schema-validator';
import type { OutboxEvent } from '../../messaging/entities/outbox-event.entity';
import { toMessage } from '../../messaging/outbox/envelope';
import type { OutboxEventInput } from '../bookings.ports';
import type { Booking } from '../entities/booking.entity';
import { BookingActivityService, BookingRoutingKey } from './booking-activity.service';

/**
 * Contract test: what we publish for booking.* is valid against the schemas we
 * give partners (src/messaging/contract/schemas.ts = docs/integration/schemas).
 */
describe('booking.* contract v1', () => {
  const validator = new SchemaValidator();
  const written: OutboxEventInput[] = [];
  const service = new BookingActivityService({
    add: async (_m, event) => {
      written.push(event);
    },
  });
  const manager = {
    getRepository: () => ({ save: async () => [], create: (x: unknown) => x }),
  } as unknown as EntityManager;

  const booking = (lms: boolean) =>
    ({
      id: '7d0e4c1a-2b3c-4d5e-8f90-1a2b3c4d5e6f',
      groupId: null,
      userId: '44440000-0000-4000-8000-000000000002',
      seatId: '5f2c8e1d-9a0b-4c3d-8e4f-5a6b7c8d9e0f',
      seat: {
        placeId: '1b7d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e3f',
        externalId: lms ? '57' : null,
        place: lms
          ? { externalSystem: 'library', externalId: '1' }
          : { externalSystem: null, externalId: null },
      },
      source: BookingSource.APP,
      status: BookingStatus.PENDING,
      timeRange: {
        start: new Date('2026-11-10T02:00:00.000Z'),
        end: new Date('2026-11-10T04:00:00.000Z'),
      },
    }) as unknown as Booking;

  const publish = (e: OutboxEventInput) =>
    toMessage({
      id: '0b8f5a8e-6a0f-4f0a-9c51-2b1f0e7d9a10',
      ...e,
      occurredAt: new Date(),
      publishedAt: null,
      attempts: 0,
      lastError: null,
    } as OutboxEvent);

  const expectValid = (body: ReturnType<typeof publish>['body']) => {
    expect(() => validator.assertEnvelope(body)).not.toThrow();
    expect(() => validator.assertData(body.type, body.version, body.data)).not.toThrow();
  };

  beforeEach(() => {
    written.length = 0;
  });

  it.each([
    [BookingEventType.CREATED, BookingRoutingKey.CREATED],
    [BookingEventType.CHECKED_IN, BookingRoutingKey.CHECKED_IN],
    [BookingEventType.CHECKED_OUT, BookingRoutingKey.CHECKED_OUT],
    [BookingEventType.EXPIRED, BookingRoutingKey.EXPIRED],
    [BookingEventType.OVERDUE, BookingRoutingKey.CHECKOUT_OVERDUE],
  ])('%s is valid, with nulls for the optional fields', async (event, routingKey) => {
    await service.record(manager, [booking(false)], { event, routingKey, actor: 'system' });
    const { body } = publish(written[0]);
    expectValid(body);
    expect(body.data).toMatchObject({
      previousStartAt: null,
      previousEndAt: null,
      cancelReason: null,
      external: null,
    });
  });

  it('MODIFIED carries the previous range', async () => {
    await service.record(manager, [booking(false)], {
      event: BookingEventType.MODIFIED,
      routingKey: BookingRoutingKey.MODIFIED,
      actor: { userId: '44440000-0000-4000-8000-000000000002' },
      oldRanges: new Map([
        [
          '7d0e4c1a-2b3c-4d5e-8f90-1a2b3c4d5e6f',
          { start: new Date('2026-11-10T01:00:00.000Z'), end: new Date('2026-11-10T03:00:00.000Z') },
        ],
      ]),
    });
    const { body } = publish(written[0]);
    expectValid(body);
    expect(body.data.previousStartAt).toBe('2026-11-10T01:00:00.000Z');
  });

  it('CANCELLED at an LMS place carries the machine reason and LMS ids', async () => {
    await service.record(manager, [booking(true)], {
      event: BookingEventType.CANCELLED,
      routingKey: BookingRoutingKey.CANCELLED,
      actor: 'system',
      cancelReason: 'LIBRARY_PLACE_CHANGED',
      metadata: { reason: 'free text that must not be published' },
    });
    const { body } = publish(written[0]);
    expectValid(body);
    expect(body.data.cancelReason).toBe('LIBRARY_PLACE_CHANGED');
    expect(body.data.external).toEqual({ system: 'library', placeId: '1', seatId: '57', memberId: null });
    expect(JSON.stringify(body)).not.toContain('free text');
  });

  it('never puts secrets in the payload', async () => {
    await service.record(manager, [booking(true)], {
      event: BookingEventType.CREATED,
      routingKey: BookingRoutingKey.CREATED,
      actor: 'system',
    });
    const text = JSON.stringify(publish(written[0]).body).toLowerCase();
    for (const word of ['idempotency', 'token', 'qr', 'password', 'email', 'hash']) {
      expect(text).not.toContain(word);
    }
  });
});

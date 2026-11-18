import type { EntityManager } from 'typeorm';
import { NotificationType } from '../../common/enums';
import { SchemaValidator } from '../../messaging/contract/schema-validator';
import type { Notification } from '../entities/notification.entity';
import { buildAlertDueEvents } from './booking-alert-events';

const B = '7d0e4c1a-2b3c-4d5e-8f90-1a2b3c4d5e6f';
const now = new Date('2026-11-10T02:05:01.000Z');
const row = (over: Partial<Notification>): Notification =>
  ({
    id: 'n1',
    bookingId: B,
    type: NotificationType.LATE_CHECKIN,
    attempts: 0,
    scheduledAt: new Date('2026-11-10T02:05:00.000Z'),
    ...over,
  }) as Notification;

const manager = (lms: boolean) =>
  ({
    query: jest.fn(async () => [
      {
        id: B,
        group_id: null,
        seat_id: '5f2c8e1d-9a0b-4c3d-8e4f-5a6b7c8d9e0f',
        place_id: '1b7d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e3f',
        start_at: new Date('2026-11-10T02:00:00.000Z'),
        end_at: new Date('2026-11-10T04:00:00.000Z'),
        external_system: lms ? 'library' : null,
        place_external_id: lms ? '1' : null,
        seat_external_id: lms ? '57' : null,
        member_id: lms ? '88' : null,
      },
    ]),
  }) as unknown as EntityManager;

describe('buildAlertDueEvents', () => {
  const validator = new SchemaValidator();

  it('builds one valid booking.alert_due per booking and alert type, with LMS ids', async () => {
    const events = await buildAlertDueEvents(
      manager(true),
      [row({ id: 'n1' }), row({ id: 'n2' }) /* same booking+type on another channel */],
      now,
    );
    expect(events).toHaveLength(1);
    const { schemaVersion, ...data } = events[0].payload;
    expect(schemaVersion).toBe(1);
    expect(() => validator.assertData('booking.alert_due', 1, data)).not.toThrow();
    expect(data).toMatchObject({
      alertType: 'LATE_CHECKIN',
      dueAt: '2026-11-10T02:05:00.000Z',
      external: { system: 'library', placeId: '1', seatId: '57', memberId: '88' },
    });
  });

  it('skips retries, other types and rows without a booking; no query when nothing qualifies', async () => {
    const m = manager(false);
    const events = await buildAlertDueEvents(
      m,
      [
        row({ attempts: 1 }),
        row({ type: NotificationType.BOOKING_CONFIRMED }),
        row({ bookingId: null }),
      ],
      now,
    );
    expect(events).toEqual([]);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('sends external: null at places LMS does not manage', async () => {
    const [e] = await buildAlertDueEvents(manager(false), [row({ type: NotificationType.CHECKOUT_REMINDER })], now);
    expect(e.payload.external).toBeNull();
  });
});

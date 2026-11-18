import type { EntityManager } from 'typeorm';
import { NotificationType } from '../../common/enums';
import { MessageType } from '../../messaging/contract/schemas';
import type { BookingAlertDueV1 } from '../../messaging/contract/types';
import type { NewOutboxEvent } from '../../messaging/outbox/outbox.service';
import type { Notification } from '../entities/notification.entity';

/** Alerts that are not status changes, so partners get them as booking.alert_due (contract §4.4). */
export const ALERT_DUE_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.LATE_CHECKIN,
  NotificationType.CHECKOUT_REMINDER,
  NotificationType.FORGOTTEN_CHECKOUT,
]);

interface BookingFacts {
  id: string;
  group_id: string | null;
  seat_id: string;
  place_id: string;
  start_at: Date;
  end_at: Date;
  external_system: string | null;
  place_external_id: string | null;
  seat_external_id: string | null;
  member_id: string | null;
}

/**
 * booking.alert_due events for the due rows of a dispatch run: one per booking
 * and alert type, on the first attempt only (retries of the delivery don't
 * repeat the fact), whatever the channel outcome, so a user without Telegram
 * still produces it.
 *
 * shortcut: reads bookings/seats/places/external_identities directly with SQL;
 * notifications can't import bookings (bookings -> notifications,
 * docs/project-structure.md section 3).
 */
export async function buildAlertDueEvents(
  manager: EntityManager,
  due: Notification[],
  now: Date,
): Promise<NewOutboxEvent<typeof MessageType.BOOKING_ALERT_DUE>[]> {
  const rows = due.filter((n) => n.bookingId && n.attempts === 0 && ALERT_DUE_TYPES.has(n.type));
  if (rows.length === 0) return [];
  const facts: BookingFacts[] = await manager.query(
    `SELECT b.id, b.group_id, b.seat_id, s.place_id,
            lower(b.time_range) AS start_at, upper(b.time_range) AS end_at,
            p.external_system, p.external_id AS place_external_id, s.external_id AS seat_external_id,
            ei.external_user_id AS member_id
       FROM bookings b
       JOIN seats s ON s.id = b.seat_id
       JOIN places p ON p.id = s.place_id
       LEFT JOIN external_identities ei
              ON ei.user_id = b.user_id AND ei.external_system = p.external_system
      WHERE b.id = ANY($1)`,
    [[...new Set(rows.map((n) => n.bookingId!))]],
  );
  const byId = new Map(facts.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const events: NewOutboxEvent<typeof MessageType.BOOKING_ALERT_DUE>[] = [];
  for (const n of rows) {
    const f = byId.get(n.bookingId!);
    const key = `${n.bookingId}|${n.type}`;
    if (!f || seen.has(key)) continue;
    seen.add(key);
    const data: BookingAlertDueV1 = {
      bookingId: f.id,
      groupId: f.group_id,
      seatId: f.seat_id,
      placeId: f.place_id,
      alertType: n.type as BookingAlertDueV1['alertType'],
      startAt: new Date(f.start_at).toISOString(),
      endAt: new Date(f.end_at).toISOString(),
      dueAt: n.scheduledAt.toISOString(),
      occurredAt: now.toISOString(),
      external:
        f.external_system === 'library' && f.place_external_id
          ? {
              system: 'library',
              placeId: f.place_external_id,
              seatId: f.seat_external_id,
              memberId: f.member_id,
            }
          : null,
    };
    events.push({
      aggregateType: 'booking',
      aggregateId: f.id,
      eventType: MessageType.BOOKING_ALERT_DUE,
      payload: { schemaVersion: 1, ...data },
    });
  }
  return events;
}

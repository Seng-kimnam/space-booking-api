import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BookingEventType, NotificationType } from '../../common/enums';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import type { BookingPolicy } from '../../places/entities/booking-policy.entity';
import type { ScheduleBookingAlert } from '../../notifications/services/notifications.service';
import type { BookingAlertPayload } from '../../notifications/templates/notification-templates';
import { OUTBOX } from '../bookings.ports';
import type { OutboxPort } from '../bookings.ports';
import { addMinutes } from '../domain/time';
import { BookingEvent } from '../entities/booking-event.entity';
import { Booking } from '../entities/booking.entity';

/** Who made a change. API clients will add a `clientId` variant. */
export type BookingActor = { userId: string } | 'system';

/** Outbox routing keys (docs/api-endpoints.md section 9). */
export const BookingRoutingKey = {
  CREATED: 'booking.created',
  MODIFIED: 'booking.modified',
  EXTENDED: 'booking.extended',
  CANCELLED: 'booking.cancelled',
  CHECKED_IN: 'booking.checked_in',
  CHECKED_OUT: 'booking.checked_out',
  EXPIRED: 'booking.expired',
  CHECKOUT_OVERDUE: 'booking.checkout_overdue',
} as const;

export interface RecordOptions {
  event: BookingEventType;
  routingKey: (typeof BookingRoutingKey)[keyof typeof BookingRoutingKey];
  actor: BookingActor;
  /** MODIFIED / EXTENDED: range before the change, by booking id. */
  oldRanges?: Map<string, TimeRange>;
  metadata?: Record<string, unknown>;
}

/** Bump when the payload shape changes (it's a public contract). */
const EVENT_SCHEMA_VERSION = 1;

/**
 * Writes the booking_events and outbox_events rows that every booking change
 * needs, on the caller's transaction (AGENTS.md section 6.11). Also builds the
 * alert payloads, so all modules render the same data.
 */
@Injectable()
export class BookingActivityService {
  constructor(@Inject(OUTBOX) private readonly outbox: OutboxPort) {}

  async record(
    manager: EntityManager,
    bookings: Booking[],
    options: RecordOptions,
  ): Promise<void> {
    if (bookings.length === 0) return;
    const actorUserId = options.actor === 'system' ? null : options.actor.userId;
    const rangeChanged =
      options.event === BookingEventType.MODIFIED ||
      options.event === BookingEventType.EXTENDED;

    const events = manager.getRepository(BookingEvent);
    await events.save(
      bookings.map((b) =>
        events.create({
          bookingId: b.id,
          type: options.event,
          oldRange: rangeChanged ? (options.oldRanges?.get(b.id) ?? null) : null,
          newRange: rangeChanged ? b.timeRange : null,
          actorUserId,
          actorSystem: options.actor === 'system',
          metadata: { groupId: b.groupId, ...options.metadata },
        }),
      ),
    );

    for (const b of bookings) {
      await this.outbox.add(manager, {
        aggregateType: 'booking',
        aggregateId: b.id,
        eventType: options.routingKey,
        // No secrets: no idempotency key, no QR data.
        payload: {
          schemaVersion: EVENT_SCHEMA_VERSION,
          bookingId: b.id,
          groupId: b.groupId,
          userId: b.userId,
          seatId: b.seatId,
          placeId: b.seat?.placeId ?? null,
          source: b.source,
          status: b.status,
          startAt: b.timeRange.start.toISOString(),
          endAt: b.timeRange.end.toISOString(),
          ...(rangeChanged && options.oldRanges?.get(b.id)
            ? {
                previousStartAt: options.oldRanges.get(b.id)!.start.toISOString(),
                previousEndAt: options.oldRanges.get(b.id)!.end.toISOString(),
              }
            : {}),
          actor: actorUserId ? { userId: actorUserId } : { system: true },
          occurredAt: new Date().toISOString(),
        },
      });
    }
  }

  alertPayload(
    booking: Booking,
    seat: { label: string },
    place: { name: string; timezone: string },
    policy?: BookingPolicy,
  ): BookingAlertPayload {
    return {
      groupId: booking.groupId ?? booking.id,
      placeName: place.name,
      timezone: place.timezone,
      seatLabels: [seat.label],
      startAt: booking.timeRange.start.toISOString(),
      endAt: booking.timeRange.end.toISOString(),
      ...(policy
        ? {
            checkinDeadline: addMinutes(
              booking.timeRange.start,
              policy.checkinGraceMinutes,
            ).toISOString(),
          }
        : {}),
    };
  }

  /**
   * Alerts scheduled when a booking is created:
   *   BOOKING_CONFIRMED  now
   *   LATE_CHECKIN       start + late_checkin_alert_minutes (skipped on check-in)
   *   CHECKOUT_REMINDER  end - checkout_reminder_minutes (only if after the start)
   * BOOKING_EXPIRED and FORGOTTEN_CHECKOUT are added by the jobs when they happen.
   */
  initialAlerts(
    booking: Booking,
    payload: BookingAlertPayload,
    policy: BookingPolicy,
    now: Date,
  ): ScheduleBookingAlert[] {
    const base = { userId: booking.userId, bookingId: booking.id, payload };
    const alerts: ScheduleBookingAlert[] = [
      { ...base, type: NotificationType.BOOKING_CONFIRMED, scheduledAt: now },
      {
        ...base,
        type: NotificationType.LATE_CHECKIN,
        scheduledAt: this.lateCheckinAt(booking.timeRange, policy),
      },
    ];
    const reminderAt = this.checkoutReminderAt(booking.timeRange, policy);
    if (reminderAt) {
      alerts.push({ ...base, type: NotificationType.CHECKOUT_REMINDER, scheduledAt: reminderAt });
    }
    return alerts;
  }

  lateCheckinAt(range: TimeRange, policy: BookingPolicy): Date {
    return addMinutes(range.start, policy.lateCheckinAlertMinutes);
  }

  /** Null when the booking is too short for a reminder (end - N is not after the start). */
  checkoutReminderAt(range: TimeRange, policy: BookingPolicy): Date | null {
    const at = addMinutes(range.end, -policy.checkoutReminderMinutes);
    return at > range.start ? at : null;
  }
}

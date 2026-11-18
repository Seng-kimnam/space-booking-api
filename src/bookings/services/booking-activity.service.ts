import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BookingEventType, NotificationType } from '../../common/enums';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import type { BookingPolicy } from '../../places/entities/booking-policy.entity';
import type { ScheduleBookingAlert } from '../../notifications/services/notifications.service';
import type { BookingAlertPayload } from '../../notifications/templates/notification-templates';
import { MessageType } from '../../messaging/contract/schemas';
import type { BookingEventV1, BookingExternalV1 } from '../../messaging/contract/types';
import { ExternalIdentitiesService } from '../../external-identities/external-identities.service';
import { OUTBOX } from '../bookings.ports';
import type { OutboxPort } from '../bookings.ports';
import { addMinutes } from '../domain/time';
import { BookingEvent } from '../entities/booking-event.entity';
import { Booking } from '../entities/booking.entity';

/** Who made a change. API clients will add a `clientId` variant. */
export type BookingActor = { userId: string } | 'system';

/**
 * Machine reason on booking.cancelled events (docs/integration/schemas/booking.v1.json).
 * User free text stays in bookings.cancel_reason and is never published.
 */
export type CancelReasonCode = 'USER_CANCELLED' | 'ADMIN_CANCELLED' | 'LIBRARY_PLACE_CHANGED';

/** Booking routing keys, from the contract registry (src/messaging/contract/schemas.ts). */
export const BookingRoutingKey = {
  CREATED: MessageType.BOOKING_CREATED,
  MODIFIED: MessageType.BOOKING_MODIFIED,
  EXTENDED: MessageType.BOOKING_EXTENDED,
  CANCELLED: MessageType.BOOKING_CANCELLED,
  CHECKED_IN: MessageType.BOOKING_CHECKED_IN,
  CHECKED_OUT: MessageType.BOOKING_CHECKED_OUT,
  EXPIRED: MessageType.BOOKING_EXPIRED,
  CHECKOUT_OVERDUE: MessageType.BOOKING_CHECKOUT_OVERDUE,
} as const;

export interface RecordOptions {
  event: BookingEventType;
  routingKey: (typeof BookingRoutingKey)[keyof typeof BookingRoutingKey];
  actor: BookingActor;
  /** MODIFIED / EXTENDED: range before the change, by booking id. */
  oldRanges?: Map<string, TimeRange>;
  /** CANCELLED only. */
  cancelReason?: CancelReasonCode;
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
  constructor(
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    private readonly identities: ExternalIdentitiesService,
  ) {}

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

    const memberIds = await this.partnerMemberIds(manager, bookings);
    for (const b of bookings) {
      const payload: BookingEventV1 & { schemaVersion: number } = {
        // No secrets: no idempotency key, no QR data. Shape: booking.v1.json.
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
          previousStartAt:
            (rangeChanged && options.oldRanges?.get(b.id)?.start.toISOString()) || null,
          previousEndAt:
            (rangeChanged && options.oldRanges?.get(b.id)?.end.toISOString()) || null,
          actor: actorUserId ? { userId: actorUserId } : { system: true },
          cancelReason:
            options.event === BookingEventType.CANCELLED ? (options.cancelReason ?? null) : null,
          occurredAt: new Date().toISOString(),
          external: this.externalIds(b, memberIds),
      };
      await this.outbox.add(manager, {
        aggregateType: 'booking',
        aggregateId: b.id,
        eventType: options.routingKey,
        payload,
      });
    }
  }

  /** Linked partner member ids (userId -> memberId) for bookings at partner-managed places. */
  private async partnerMemberIds(
    manager: EntityManager,
    bookings: Booking[],
  ): Promise<Map<string, string>> {
    const bySystem = new Map<string, string[]>();
    for (const b of bookings) {
      const system = b.seat?.place?.externalSystem;
      if (system) bySystem.set(system, [...(bySystem.get(system) ?? []), b.userId]);
    }
    const result = new Map<string, string>();
    for (const [system, userIds] of bySystem)
      for (const [userId, memberId] of await this.identities.memberIdsForUsers(manager, system, userIds))
        result.set(`${system}|${userId}`, memberId);
    return result;
  }

  /** Partner ids (LMS) for a booking at a partner-managed place, else null. Needs seat + place loaded. */
  private externalIds(b: Booking, memberIds: Map<string, string>): BookingExternalV1 | null {
    const place = b.seat?.place;
    if (place?.externalSystem !== 'library' || !place.externalId) return null;
    return {
      system: place.externalSystem,
      placeId: place.externalId,
      seatId: b.seat.externalId ?? null,
      // Set only when the user linked their LMS account (explicit link flow).
      memberId: memberIds.get(`${place.externalSystem}|${b.userId}`) ?? null,
    };
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

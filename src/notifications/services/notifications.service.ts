import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { NotificationChannel, NotificationType } from '../../common/enums';
import { NotificationsRepository } from '../repositories/notifications.repository';
import type { BookingAlertPayload } from '../templates/notification-templates';

export interface ScheduleBookingAlert {
  userId: string;
  bookingId: string;
  type: NotificationType;
  scheduledAt: Date;
  payload: BookingAlertPayload;
}

const EMAIL_TYPES = new Set<NotificationType>([
  NotificationType.EMAIL_VERIFY_OTP,
  NotificationType.PASSWORD_RESET_OTP,
]);

/**
 * Booking-facing API. Every method takes the caller's EntityManager, so alerts
 * are written in the same transaction as the booking change (AGENTS.md section
 * 6.11). Delivery happens later, in NotificationDispatcher.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  /** Channel rule (docs/erd.md): EMAIL for auth OTPs only, booking alerts on TELEGRAM. */
  channelFor(type: NotificationType): NotificationChannel {
    return EMAIL_TYPES.has(type)
      ? NotificationChannel.EMAIL
      : NotificationChannel.TELEGRAM;
  }

  /**
   * Idempotent per (booking, type, channel) for once-per-booking alerts; change
   * alerts (BOOKING_MODIFIED, BOOKING_EXTENDED, CHECKED_IN, CHECKED_OUT) insert a row per change.
   */
  schedule(manager: EntityManager, alerts: ScheduleBookingAlert[]): Promise<void> {
    return this.repository.insertIgnoringDuplicates(
      manager,
      alerts.map((a) => ({
        userId: a.userId,
        bookingId: a.bookingId,
        channel: this.channelFor(a.type),
        type: a.type,
        scheduledAt: a.scheduledAt,
        payload: a.payload,
      })),
    );
  }

  /** Moves a still-pending alert (after modify / extend). Already-sent ones stay sent. */
  reschedule(
    manager: EntityManager,
    bookingIds: string[],
    type: NotificationType,
    scheduledAt: Date,
    /** New times for the message (e.g. startAt/endAt after a modify). */
    payloadPatch?: Partial<BookingAlertPayload>,
  ): Promise<void> {
    return this.repository.reschedulePending(manager, bookingIds, type, scheduledAt, payloadPatch);
  }

  /** Pending alerts that no longer apply (checked in, cancelled, expired) become SKIPPED. */
  skipPending(
    manager: EntityManager,
    bookingIds: string[],
    types?: NotificationType[],
  ): Promise<void> {
    return this.repository.skipPending(manager, bookingIds, types);
  }
}

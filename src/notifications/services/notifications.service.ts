import { Injectable, Logger } from '@nestjs/common';
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
  // debug: one line per booking change would be noisy at log level. These run
  // on the caller's transaction, so "queued" = written if that change commits;
  // the dispatcher logs actual delivery. Ids and types only, never payloads.
  private readonly logger = new Logger(NotificationsService.name);

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
  schedule(
    manager: EntityManager,
    alerts: ScheduleBookingAlert[],
  ): Promise<void> {
    if (alerts.length > 0) {
      const bookings = [...new Set(alerts.map((a) => a.bookingId))].join(',');
      const summary = alerts
        .map((a) => `${a.type}@${a.scheduledAt.toISOString()}`)
        .join(', ');
      this.logger.debug(`Alerts queued: bookings=${bookings} ${summary}`);
    }
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
    if (bookingIds.length > 0) {
      this.logger.debug(
        `Alert rescheduled: ${type} -> ${scheduledAt.toISOString()} bookings=${bookingIds.join(',')}`,
      );
    }
    return this.repository.reschedulePending(
      manager,
      bookingIds,
      type,
      scheduledAt,
      payloadPatch,
    );
  }

  /**
   * Queues a once-per-booking alert again for a new time, even if it was
   * already sent or skipped (CHECKOUT_REMINDER after an extend or modify),
   * creating it where it doesn't exist yet.
   */
  rearm(
    manager: EntityManager,
    alerts: ScheduleBookingAlert[],
  ): Promise<void> {
    if (alerts.length > 0) {
      this.logger.debug(
        `Alerts re-armed: ${alerts.map((a) => `${a.type}@${a.scheduledAt.toISOString()}`).join(', ')} bookings=${alerts.map((a) => a.bookingId).join(',')}`,
      );
    }
    return this.repository.rearm(
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

  /** Pending alerts that no longer apply (checked in, cancelled, expired) become SKIPPED. */
  skipPending(
    manager: EntityManager,
    bookingIds: string[],
    types?: NotificationType[],
  ): Promise<void> {
    if (bookingIds.length > 0) {
      this.logger.debug(
        `Pending alerts skipped: types=${types?.join('|') ?? 'all'} bookings=${bookingIds.join(',')}`,
      );
    }
    return this.repository.skipPending(manager, bookingIds, types);
  }
}

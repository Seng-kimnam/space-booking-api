import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BookingEventType,
  BookingStatus,
  NotificationType,
} from '../../common/enums';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NO_SHOW_COUNTER } from '../bookings.ports';
import type { NoShowCounterPort } from '../bookings.ports';
import { BookingsRepository } from '../repositories/bookings.repository';
import { BookingActivityService, BookingRoutingKey } from './booking-activity.service';
import { BookingQrService } from './booking-qr.service';

const DEFAULT_BATCH = 100;

/**
 * Time-driven status changes, run by the scheduled jobs (never lazily on read,
 * AGENTS.md section 6.4). `now` is a parameter so tests can drive the clock.
 * Booking statuses change here; seats.status is never touched. A seat is free
 * again as soon as its booking leaves PENDING/CHECKED_IN/CHECKOUT_OVERDUE.
 */
@Injectable()
export class BookingLifecycleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly bookings: BookingsRepository,
    private readonly activity: BookingActivityService,
    private readonly qr: BookingQrService,
    private readonly notifications: NotificationsService,
    @Inject(NO_SHOW_COUNTER) private readonly noShows: NoShowCounterPort,
  ) {}

  /**
   * PENDING and not checked in by start + checkin_grace_minutes -> EXPIRED.
   * Counts a no-show (once per multi-seat booking), revokes QR codes, and
   * replaces pending alerts with BOOKING_EXPIRED. Returns how many expired.
   */
  expireDue(now: Date, limit = DEFAULT_BATCH): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const due = await this.bookings.claimExpirable(manager, now, limit);
      if (due.length === 0) return 0;
      const ids = due.map((b) => b.id);

      await this.bookings.updateFields(manager, ids, {
        status: BookingStatus.EXPIRED,
        expiredAt: now,
      });

      const noShowGroups = new Map<string, string>();
      for (const b of due) noShowGroups.set(b.groupId ?? b.id, b.userId);
      for (const userId of noShowGroups.values()) {
        await this.noShows.incrementNoShow(manager, userId);
      }

      await this.qr.revokeLive(manager, ids);
      await this.notifications.skipPending(manager, ids);
      await this.notifications.schedule(
        manager,
        due.map((b) => ({
          userId: b.userId,
          bookingId: b.id,
          type: NotificationType.BOOKING_EXPIRED,
          scheduledAt: now,
          payload: this.activity.alertPayload(b, b.seat, b.seat.place),
        })),
      );
      for (const b of due) b.status = BookingStatus.EXPIRED;
      await this.activity.record(manager, due, {
        event: BookingEventType.EXPIRED,
        routingKey: BookingRoutingKey.EXPIRED,
        actor: 'system',
      });
      return due.length;
    });
  }

  /**
   * CHECKED_IN and not checked out by end + overdue_alert_minutes ->
   * CHECKOUT_OVERDUE, with a FORGOTTEN_CHECKOUT alert. The seat still counts as
   * occupied now until the user checks out or an admin resolves it.
   */
  markOverdue(now: Date, limit = DEFAULT_BATCH): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const due = await this.bookings.claimOverdue(manager, now, limit);
      if (due.length === 0) return 0;
      const ids = due.map((b) => b.id);

      await this.bookings.updateFields(manager, ids, {
        status: BookingStatus.CHECKOUT_OVERDUE,
      });
      await this.notifications.skipPending(manager, ids, [NotificationType.CHECKOUT_REMINDER]);
      await this.notifications.schedule(
        manager,
        due.map((b) => ({
          userId: b.userId,
          bookingId: b.id,
          type: NotificationType.FORGOTTEN_CHECKOUT,
          scheduledAt: now,
          payload: this.activity.alertPayload(b, b.seat, b.seat.place),
        })),
      );
      for (const b of due) b.status = BookingStatus.CHECKOUT_OVERDUE;
      await this.activity.record(manager, due, {
        event: BookingEventType.OVERDUE,
        routingKey: BookingRoutingKey.CHECKOUT_OVERDUE,
        actor: 'system',
      });
      return due.length;
    });
  }
}

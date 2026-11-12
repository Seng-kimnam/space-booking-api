import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { Booking } from '../entities/booking.entity';
import {
  BookingActivityService,
  BookingRoutingKey,
} from './booking-activity.service';
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
  // Forwards to AppLogger (main.ts). The jobs log only counts; this logs which
  // bookings changed, after commit, so no-shows and overdue seats are traceable.
  private readonly logger = new Logger(BookingLifecycleService.name);

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
  async expireDue(now: Date, limit = DEFAULT_BATCH): Promise<number> {
    const expired = await this.dataSource.transaction(async (manager) => {
      const due = await this.bookings.claimExpirable(manager, now, limit);
      if (due.length === 0) return [];
      const ids = due.map((b) => b.id);

      await this.bookings.updateFields(manager, ids, {
        status: BookingStatus.EXPIRED,
        expiredAt: now,
      });

      // Once per multi-seat booking, across runs: a group split over batches,
      // or whose seats expire at different times after a per-seat modify, is
      // counted by the first run only, and not at all if a seat was attended.
      const noShowGroups = new Map<string, { userId: string; grouped: boolean }>();
      for (const b of due)
        noShowGroups.set(b.groupId ?? b.id, { userId: b.userId, grouped: !!b.groupId });
      // Sorted: advisory locks are always taken in the same order (no deadlock between instances).
      for (const key of [...noShowGroups.keys()].sort()) {
        const { userId, grouped } = noShowGroups.get(key)!;
        if (grouped && (await this.bookings.noShowAlreadySettled(manager, key, ids))) continue;
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
      return due;
    });
    this.logGroups('Booking expired (no-show)', expired);
    return expired.length;
  }

  /**
   * CHECKED_IN and not checked out by end + overdue_alert_minutes ->
   * CHECKOUT_OVERDUE, with a FORGOTTEN_CHECKOUT alert. The seat still counts as
   * occupied now until the user checks out or an admin resolves it.
   */
  async markOverdue(now: Date, limit = DEFAULT_BATCH): Promise<number> {
    const overdue = await this.dataSource.transaction(async (manager) => {
      const due = await this.bookings.claimOverdue(manager, now, limit);
      if (due.length === 0) return [];
      const ids = due.map((b) => b.id);

      await this.bookings.updateFields(manager, ids, {
        status: BookingStatus.CHECKOUT_OVERDUE,
      });
      await this.notifications.skipPending(manager, ids, [
        NotificationType.CHECKOUT_REMINDER,
      ]);
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
      return due;
    });
    this.logGroups('Booking checkout overdue', overdue);
    return overdue.length;
  }

  /** One line per booking group (a multi-seat booking is one user action). */
  private logGroups(event: string, bookings: Booking[]): void {
    const groups = new Map<string, Booking[]>();
    for (const b of bookings) {
      const key = b.groupId ?? b.id;
      groups.set(key, [...(groups.get(key) ?? []), b]);
    }
    for (const [group, rows] of groups) {
      this.logger.log(
        `${event}: group=${group} bookings=${rows.map((b) => b.id).join(',')} user=${rows[0].userId}`,
      );
    }
  }
}

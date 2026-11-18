import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  BookingEventType,
  BookingStatus,
  NotificationType,
} from '../../common/enums';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { assertTransition } from '../domain/booking-state';
import { Booking } from '../entities/booking.entity';
import { BookingsRepository } from '../repositories/bookings.repository';
import {
  BookingActivityService,
  BookingActor,
  BookingRoutingKey,
  CancelReasonCode,
} from './booking-activity.service';
import { BookingQrService } from './booking-qr.service';

/**
 * Cancelling bookings on the caller's transaction (AGENTS.md section 6.10,
 * 6.11). Separate from BookingsService because place and seat admin writes
 * reach it through the PLACE_CHANGE_BOOKINGS port, and BookingsService depends
 * on seats and places itself (that would be a dependency cycle).
 */
@Injectable()
export class BookingCancellationService {
  private readonly logger = new Logger(BookingCancellationService.name);

  constructor(
    private readonly bookings: BookingsRepository,
    private readonly activity: BookingActivityService,
    private readonly qr: BookingQrService,
    private readonly notifications: NotificationsService,
  ) {}

  /** CANCELLED + cancelled_at/by, QR revoked, pending alerts skipped, cancellation alert, event + outbox. */
  async cancel(
    manager: EntityManager,
    targets: Booking[],
    actor: BookingActor,
    reason: string | null,
    now: Date,
    cancelReason: CancelReasonCode,
    extraMetadata: Record<string, unknown> = {},
  ): Promise<void> {
    for (const b of targets)
      assertTransition(b.status, BookingStatus.CANCELLED);
    const ids = targets.map((b) => b.id);
    await this.bookings.updateFields(manager, ids, {
      status: BookingStatus.CANCELLED,
      cancelledAt: now,
      cancelledBy: actor === 'system' ? null : actor.userId,
      cancelReason: reason,
    });
    await this.qr.revokeLive(manager, ids);
    await this.notifications.skipPending(manager, ids);
    await this.notifications.schedule(
      manager,
      targets.map((b) => ({
        userId: b.userId,
        bookingId: b.id,
        type: NotificationType.BOOKING_CANCELLED,
        scheduledAt: now,
        payload: this.activity.alertPayload(b, b.seat, b.seat.place),
      })),
    );
    for (const b of targets) b.status = BookingStatus.CANCELLED;
    await this.activity.record(manager, targets, {
      event: BookingEventType.CANCELLED,
      routingKey: BookingRoutingKey.CANCELLED,
      actor,
      cancelReason,
      metadata: { ...(reason ? { reason } : {}), ...extraMetadata },
    });
  }

  /**
   * System cancellation because a place or seat changed under the booking:
   * by the partner (LMS place sync, LIBRARY_PLACE_CHANGED) or by our admins
   * (ADMIN_CANCELLED; docs/improvement-plan.md item 1). Each booking is
   * cancelled on its own; other seats of its group may stay. Bookings no longer
   * PENDING are left alone. Users get the normal cancellation alert.
   */
  async cancelForPlaceChange(
    manager: EntityManager,
    cancellations: { bookingId: string; subReason: string }[],
    now: Date,
    cancelReason: Extract<
      CancelReasonCode,
      'LIBRARY_PLACE_CHANGED' | 'ADMIN_CANCELLED'
    >,
  ): Promise<number> {
    if (cancellations.length === 0) return 0;
    const bookings = await this.bookings.findByIds(
      cancellations.map((c) => c.bookingId),
      manager,
    );
    const subReasons = new Map(
      cancellations.map((c) => [c.bookingId, c.subReason]),
    );
    const who =
      cancelReason === 'LIBRARY_PLACE_CHANGED'
        ? 'Library place'
        : 'Place or seat';
    let cancelled = 0;
    for (const b of bookings) {
      if (b.status !== BookingStatus.PENDING) continue;
      const subReason = subReasons.get(b.id) ?? 'OTHER';
      await this.cancel(
        manager,
        [b],
        'system',
        `${who} changed (${subReason})`,
        now,
        cancelReason,
        { subReason },
      );
      cancelled++;
    }
    // Logged before the caller commits: the caller logs its own change after commit.
    if (cancelled > 0)
      this.logger.log(
        `Bookings cancelled by place change: count=${cancelled} reason=${cancelReason}`,
      );
    return cancelled;
  }
}

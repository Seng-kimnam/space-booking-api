import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  AttendanceMethod,
  BookingEventType,
  BookingStatus,
  NotificationType,
  QrPurpose,
  UserRole,
} from '../../common/enums';
import type { AuthUser } from '../../common/types/auth-user';
import { bookingConfig } from '../../configuration/booking.config';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { PLACE_RULES } from '../bookings.ports';
import type { PlaceRulesPort } from '../bookings.ports';
import { assertTransition } from '../domain/booking-state';
import { hashQrSecret, parseQrPayload } from '../domain/qr-token';
import { formatInZone, minutesBetween } from '../domain/time';
import {
  AttendanceResponseDto,
  CheckInStatusResponseDto,
  toBookingResponse,
} from '../dto/booking-response.dto';
import { BookingQrToken } from '../entities/booking-qr-token.entity';
import { Booking } from '../entities/booking.entity';
import { BookingsRepository } from '../repositories/bookings.repository';
import {
  BookingActivityService,
  BookingRoutingKey,
} from './booking-activity.service';
import { BookingQrService } from './booking-qr.service';
import { BookingRulesService } from './booking-rules.service';

// Same message for unknown, used, revoked and expired codes: don't help guessing.
const INVALID_QR = 'This QR code is invalid, already used or expired';

/**
 * Check-in / check-out by one-time QR or manually by an admin. The QR token is
 * marked used in the same transaction as the status change (AGENTS.md 6.3).
 */
@Injectable()
export class AttendanceService {
  // Forwards to AppLogger (main.ts). Logged after commit; never the QR text.
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly bookings: BookingsRepository,
    private readonly rules: BookingRulesService,
    private readonly activity: BookingActivityService,
    private readonly qr: BookingQrService,
    private readonly notifications: NotificationsService,
    @Inject(PLACE_RULES) private readonly placeRules: PlaceRulesPort,
    @Inject(bookingConfig.KEY)
    private readonly config: ConfigType<typeof bookingConfig>,
  ) {}

  /** A GROUP QR checks in/out every seat it covers; a seat QR just that seat. */
  async scan(
    actor: AuthUser,
    qrText: string,
    purpose: QrPurpose,
  ): Promise<AttendanceResponseDto> {
    const parsed = parseQrPayload(qrText);
    if (!parsed) throw new BadRequestException(INVALID_QR);
    const now = new Date();

    const ids = await this.dataSource.transaction(async (manager) => {
      const candidates =
        parsed.scope === 'GROUP'
          ? await this.bookings.findGroup(parsed.id, manager, true)
          : [await this.bookings.findById(parsed.id, manager, true)].filter(
              (b): b is Booking => b !== null,
            );
      if (candidates.length === 0) throw new BadRequestException(INVALID_QR);

      const hashes = candidates.map((b) => hashQrSecret(parsed.secret, b.id));
      const tokens = await manager
        .getRepository(BookingQrToken)
        .createQueryBuilder('t')
        .where('t.tokenHash IN (:...hashes)', { hashes })
        .andWhere('t.purpose = :purpose', { purpose })
        .setLock('pessimistic_write')
        .getMany();
      const live = tokens.filter(
        (t) => !t.usedAt && !t.revokedAt && t.expiresAt > now,
      );
      const matched = candidates.filter((b) =>
        live.some((t) => t.bookingId === b.id),
      );
      if (matched.length === 0) throw new BadRequestException(INVALID_QR);

      // Users scan their own bookings; staff (ADMIN) can scan anyone's.
      if (
        actor.role !== UserRole.ADMIN &&
        matched.some((b) => b.userId !== actor.id)
      ) {
        // Someone scanning another user's QR: worth seeing in the logs.
        this.logger.warn(
          `QR ${purpose} rejected: QR belongs to another user (actor=${actor.id})`,
        );
        throw new ForbiddenException('This QR code belongs to another user');
      }

      if (purpose === QrPurpose.CHECK_IN) {
        await this.assertWithinCheckInWindow(matched, now, manager);
      }

      await manager
        .getRepository(BookingQrToken)
        .update({ id: In(live.map((t) => t.id)) }, { usedAt: now });

      if (purpose === QrPurpose.CHECK_IN) {
        await this.applyCheckIn(
          manager,
          matched,
          actor,
          AttendanceMethod.QR,
          now,
        );
      } else {
        await this.applyCheckOut(
          manager,
          matched,
          actor,
          AttendanceMethod.QR,
          now,
        );
      }
      return matched.map((b) => b.id);
    });

    this.logger.log(
      `QR ${purpose}: bookings=${ids.join(',')} actor=${actor.id} (${actor.role})`,
    );
    return {
      action: purpose,
      bookings: (await this.bookings.findByIds(ids)).map(toBookingResponse),
    };
  }

  /** Admin check-in without a QR (e.g. the user's phone is dead). */
  async manualCheckIn(
    admin: AuthUser,
    bookingId: string,
  ): Promise<AttendanceResponseDto> {
    return this.manual(
      admin,
      bookingId,
      async (manager, booking, now) => {
        assertTransition(booking.status, BookingStatus.CHECKED_IN);
        await this.applyCheckIn(
          manager,
          [booking],
          admin,
          AttendanceMethod.MANUAL,
          now,
        );
      },
      QrPurpose.CHECK_IN,
    );
  }

  /** Admin check-out, also for a forgotten (CHECKOUT_OVERDUE) checkout. */
  async manualCheckOut(
    admin: AuthUser,
    bookingId: string,
  ): Promise<AttendanceResponseDto> {
    return this.manual(
      admin,
      bookingId,
      async (manager, booking, now) => {
        assertTransition(booking.status, BookingStatus.COMPLETED);
        await this.applyCheckOut(
          manager,
          [booking],
          admin,
          AttendanceMethod.MANUAL,
          now,
        );
      },
      QrPurpose.CHECK_OUT,
    );
  }

  /** Admin confirms an overdue seat is free: CHECKOUT_OVERDUE -> COMPLETED. */
  async resolveOverdue(
    admin: AuthUser,
    bookingId: string,
  ): Promise<AttendanceResponseDto> {
    return this.manual(
      admin,
      bookingId,
      async (manager, booking, now) => {
        if (booking.status !== BookingStatus.CHECKOUT_OVERDUE) {
          throw new ConflictException(
            `Booking is ${booking.status}, not CHECKOUT_OVERDUE`,
          );
        }
        await this.applyCheckOut(
          manager,
          [booking],
          admin,
          AttendanceMethod.MANUAL,
          now,
          BookingEventType.OVERDUE_RESOLVED,
        );
      },
      QrPurpose.CHECK_OUT,
    );
  }

  /** Users see their own bookings; admins any (404 rather than 403 to not leak ids). */
  async getCheckInStatus(
    actor: AuthUser,
    bookingId: string,
  ): Promise<CheckInStatusResponseDto> {
    const booking = await this.bookings.findById(bookingId);
    if (
      !booking ||
      (actor.role !== UserRole.ADMIN && booking.userId !== actor.id)
    ) {
      throw new NotFoundException('Booking not found');
    }
    const { policy } = await this.placeRules.getBookingContext(
      booking.seat.placeId,
    );
    const window = this.rules.checkInWindow(
      booking.timeRange,
      policy,
      this.config.checkinEarlyMinutes,
    );
    const checkedIn = booking.status === BookingStatus.CHECKED_IN;
    // "Nearly timed out" is derived from upper(time_range) - now() (AGENTS.md 6.5).
    const minutesRemaining = checkedIn
      ? Math.floor(minutesBetween(new Date(), booking.timeRange.end))
      : null;
    return {
      bookingId: booking.id,
      status: booking.status,
      checkInOpensAt: window.opensAt,
      checkInClosesAt: window.closesAt,
      checkedInAt: booking.checkedInAt,
      checkedOutAt: booking.checkedOutAt,
      minutesRemaining,
      nearlyTimedOut:
        minutesRemaining !== null &&
        minutesRemaining <= policy.checkoutReminderMinutes,
    };
  }

  private async manual(
    admin: AuthUser,
    bookingId: string,
    change: (
      manager: EntityManager,
      booking: Booking,
      now: Date,
    ) => Promise<void>,
    action: QrPurpose,
  ): Promise<AttendanceResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.bookings.findById(bookingId, manager, true);
      if (!booking) throw new NotFoundException('Booking not found');
      await change(manager, booking, new Date());
    });
    this.logger.log(
      `Manual ${action} by admin: booking=${bookingId} admin=${admin.id}`,
    );
    const booking = await this.bookings.findById(bookingId);
    return { action, bookings: booking ? [toBookingResponse(booking)] : [] };
  }

  private async assertWithinCheckInWindow(
    bookings: Booking[],
    now: Date,
    manager: EntityManager,
  ): Promise<void> {
    const { policy } = await this.placeRules.getBookingContext(
      bookings[0].seat.placeId,
      manager,
    );
    for (const b of bookings) {
      if (b.status !== BookingStatus.PENDING) {
        throw new ConflictException(
          `Booking for seat ${b.seat.label} is ${b.status}`,
        );
      }
      const w = this.rules.checkInWindow(
        b.timeRange,
        policy,
        this.config.checkinEarlyMinutes,
      );
      if (now < w.opensAt || now > w.closesAt) {
        const tz = b.seat.place.timezone;
        throw new ConflictException(
          `Check-in for seat ${b.seat.label} is only allowed from ${formatInZone(w.opensAt, tz)} to ${formatInZone(w.closesAt, tz)}`,
        );
      }
    }
  }

  private async applyCheckIn(
    manager: EntityManager,
    bookings: Booking[],
    actor: AuthUser,
    method: AttendanceMethod,
    now: Date,
  ): Promise<void> {
    const ids = bookings.map((b) => b.id);
    await this.bookings.updateFields(manager, ids, {
      status: BookingStatus.CHECKED_IN,
      checkedInAt: now,
      checkedInBy: actor.id,
      checkInMethod: method,
    });
    // Other live check-in codes (e.g. per-seat codes after a group scan) die now.
    await this.qr.revokeLive(manager, ids, QrPurpose.CHECK_IN);
    await this.notifications.skipPending(manager, ids, [
      NotificationType.LATE_CHECKIN,
    ]);
    await this.scheduleAttendanceAlert(
      manager,
      bookings,
      NotificationType.CHECKED_IN,
      now,
    );
    for (const b of bookings) b.status = BookingStatus.CHECKED_IN;
    await this.activity.record(manager, bookings, {
      event: BookingEventType.CHECKED_IN,
      routingKey: BookingRoutingKey.CHECKED_IN,
      actor: { userId: actor.id },
      metadata: { method },
    });
  }

  private async applyCheckOut(
    manager: EntityManager,
    bookings: Booking[],
    actor: AuthUser,
    method: AttendanceMethod,
    now: Date,
    event: BookingEventType = BookingEventType.CHECKED_OUT,
  ): Promise<void> {
    for (const b of bookings) {
      assertTransition(b.status, BookingStatus.COMPLETED);
    }
    const ids = bookings.map((b) => b.id);
    await this.bookings.updateFields(manager, ids, {
      status: BookingStatus.COMPLETED,
      checkedOutAt: now,
      checkedOutBy: actor.id,
      checkOutMethod: method,
    });
    await this.qr.revokeLive(manager, ids);
    await this.notifications.skipPending(manager, ids, [
      NotificationType.CHECKOUT_REMINDER,
      NotificationType.FORGOTTEN_CHECKOUT,
    ]);
    await this.scheduleAttendanceAlert(
      manager,
      bookings,
      NotificationType.CHECKED_OUT,
      now,
    );
    for (const b of bookings) b.status = BookingStatus.COMPLETED;
    await this.activity.record(manager, bookings, {
      event,
      routingKey: BookingRoutingKey.CHECKED_OUT,
      actor: { userId: actor.id },
      metadata: { method },
    });
  }

  /** QR scan or admin manual action alike: the user hears about it on Telegram. */
  private scheduleAttendanceAlert(
    manager: EntityManager,
    bookings: Booking[],
    type: NotificationType.CHECKED_IN | NotificationType.CHECKED_OUT,
    now: Date,
  ): Promise<void> {
    return this.notifications.schedule(
      manager,
      bookings.map((b) => ({
        userId: b.userId,
        bookingId: b.id,
        type,
        scheduledAt: now,
        payload: this.activity.alertPayload(b, b.seat, b.seat.place),
      })),
    );
  }
}

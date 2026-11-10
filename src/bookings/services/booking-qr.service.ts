import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { toDataURL } from 'qrcode';
import { BookingStatus, QrPurpose } from '../../common/enums';
import type { AuthUser } from '../../common/types/auth-user';
import type { BookingPolicy } from '../../places/entities/booking-policy.entity';
import { PLACE_RULES } from '../bookings.ports';
import type { PlaceRulesPort } from '../bookings.ports';
import { buildQrPayload, hashQrSecret, newQrSecret } from '../domain/qr-token';
import { addMinutes } from '../domain/time';
import { BookingQrToken } from '../entities/booking-qr-token.entity';
import { Booking } from '../entities/booking.entity';
import { BookingsRepository } from '../repositories/bookings.repository';

/** GROUP = one QR for every seat of the booking; EACH = one QR per seat. */
export type QrMode = 'GROUP' | 'EACH';

// A forgotten checkout can still be closed by QR for this long after the end.
const CHECKOUT_QR_VALID_AFTER_END_MINUTES = 12 * 60;

export interface IssuedQrCode {
  bookingIds: string[];
  seatLabels: string[];
  /** The QR content. Shown once; only its hash is stored. */
  payload: string;
  /** PNG data URL of the QR image. */
  imageDataUrl: string;
  expiresAt: Date;
}

export interface IssuedQrCodes {
  purpose: QrPurpose;
  mode: QrMode;
  codes: IssuedQrCode[];
}

interface PendingCode {
  bookings: Booking[];
  secret: string;
  payload: string;
  expiresAt: Date;
}

/**
 * One-time QR tokens (AGENTS.md section 6.3): random secret, hash-only storage,
 * single use, and any previous live token for the same booking and purpose is
 * revoked on reissue.
 */
@Injectable()
export class BookingQrService {
  // Forwards to AppLogger (main.ts). Logged after commit. Never the QR payload
  // or secret: whoever has the payload can check in.
  private readonly logger = new Logger(BookingQrService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly bookings: BookingsRepository,
    @Inject(PLACE_RULES) private readonly placeRules: PlaceRulesPort,
  ) {}

  async issue(
    user: AuthUser,
    bookingId: string,
    purpose: QrPurpose,
    mode: QrMode,
  ): Promise<IssuedQrCodes> {
    const now = new Date();
    let revoked = 0;

    const pending = await this.dataSource.transaction(async (manager) => {
      const booking = await this.bookings.findById(bookingId, manager, true);
      if (!booking || booking.userId !== user.id) {
        throw new NotFoundException('Booking not found');
      }
      const { policy } = await this.placeRules.getBookingContext(
        booking.seat.placeId,
        manager,
      );

      // The whole group is a candidate for both modes; a single seat is a group of one.
      const group = booking.groupId
        ? (
            await this.bookings.findGroup(booking.groupId, manager, true)
          ).filter((b) => b.userId === user.id)
        : [booking];
      if (!this.isEligible(booking, purpose, now, policy)) {
        throw new ConflictException(this.ineligibleReason(booking, purpose));
      }
      const eligible = group.filter((b) =>
        this.isEligible(b, purpose, now, policy),
      );

      revoked = await this.revokeLive(
        manager,
        eligible.map((b) => b.id),
        purpose,
      );

      const codes: PendingCode[] =
        mode === 'GROUP' && eligible.length > 1
          ? [
              this.newCode(
                eligible,
                'GROUP',
                booking.groupId!,
                purpose,
                now,
                policy,
              ),
            ]
          : eligible.map((b) =>
              this.newCode([b], 'BOOKING', b.id, purpose, now, policy),
            );

      const tokens = manager.getRepository(BookingQrToken);
      await tokens.save(
        codes.flatMap((code) =>
          code.bookings.map((b) =>
            tokens.create({
              bookingId: b.id,
              purpose,
              tokenHash: hashQrSecret(code.secret, b.id),
              expiresAt: this.expiresAt(b, purpose, now, policy),
            }),
          ),
        ),
      );
      return codes;
    });

    this.logger.log(
      `QR issued: booking=${bookingId} purpose=${purpose} mode=${mode} ` +
        `codes=${pending.length} bookings=${pending.flatMap((c) => c.bookings.map((b) => b.id)).join(',')} ` +
        `revokedPrevious=${revoked} user=${user.id}`,
    );
    return {
      purpose,
      mode,
      codes: await Promise.all(
        pending.map(async (code) => ({
          bookingIds: code.bookings.map((b) => b.id),
          seatLabels: code.bookings.map((b) => b.seat.label),
          payload: code.payload,
          imageDataUrl: await toDataURL(code.payload, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 320,
          }),
          expiresAt: code.expiresAt,
        })),
      ),
    };
  }

  /**
   * Revokes live (unused, unrevoked) tokens; all purposes when `purpose` is
   * omitted. Returns how many were revoked. Runs on the caller's transaction,
   * so it doesn't log: callers log after commit.
   */
  async revokeLive(
    manager: EntityManager,
    bookingIds: string[],
    purpose?: QrPurpose,
  ): Promise<number> {
    if (bookingIds.length === 0) return 0;
    const result = await manager.getRepository(BookingQrToken).update(
      {
        bookingId: In(bookingIds),
        usedAt: IsNull(),
        revokedAt: IsNull(),
        ...(purpose ? { purpose } : {}),
      },
      { revokedAt: new Date() },
    );
    return result.affected ?? 0;
  }

  private newCode(
    bookings: Booking[],
    scope: 'GROUP' | 'BOOKING',
    id: string,
    purpose: QrPurpose,
    now: Date,
    policy: BookingPolicy,
  ): PendingCode {
    const expiries = bookings.map((b) =>
      this.expiresAt(b, purpose, now, policy).getTime(),
    );
    const secret = newQrSecret();
    return {
      bookings,
      secret,
      payload: buildQrPayload(scope, id, secret),
      expiresAt: new Date(Math.min(...expiries)),
    };
  }

  private isEligible(
    b: Booking,
    purpose: QrPurpose,
    now: Date,
    policy: BookingPolicy,
  ): boolean {
    if (purpose === QrPurpose.CHECK_IN) {
      return (
        b.status === BookingStatus.PENDING &&
        now < addMinutes(b.timeRange.start, policy.checkinGraceMinutes)
      );
    }
    return (
      b.status === BookingStatus.CHECKED_IN ||
      b.status === BookingStatus.CHECKOUT_OVERDUE
    );
  }

  private ineligibleReason(b: Booking, purpose: QrPurpose): string {
    return purpose === QrPurpose.CHECK_IN
      ? `A check-in QR can't be issued: the booking is ${b.status} or its check-in window has closed`
      : `A check-out QR can't be issued: the booking is ${b.status}, not checked in`;
  }

  /** CHECK_IN: until start + grace (then the booking expires). CHECK_OUT: until well after the end. */
  private expiresAt(
    b: Booking,
    purpose: QrPurpose,
    now: Date,
    policy: BookingPolicy,
  ): Date {
    if (purpose === QrPurpose.CHECK_IN) {
      return addMinutes(b.timeRange.start, policy.checkinGraceMinutes);
    }
    const from = b.timeRange.end > now ? b.timeRange.end : now;
    return addMinutes(from, CHECKOUT_QR_VALID_AFTER_END_MINUTES);
  }
}

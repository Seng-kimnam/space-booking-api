import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  BookingEventType,
  BookingSource,
  BookingStatus,
  NotificationType,
} from '../../common/enums';
import type { AuthUser } from '../../common/types/auth-user';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../common/utils/db-errors';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { PLACE_RULES, SEAT_LOOKUP } from '../bookings.ports';
import type { PlaceRulesPort, SeatLookupPort } from '../bookings.ports';
import {
  AdminBookingsQueryDto,
  CancelBookingDto,
  CreateBookingDto,
  ExtendBookingDto,
  ModifyBookingDto,
  MyBookingsQueryDto,
} from '../dto/booking-request.dto';
import {
  AdminBookingDetailResponseDto,
  BookingGroupResponseDto,
  BookingResponseDto,
  PaginatedBookingsResponseDto,
  toBookingEventResponse,
  toBookingResponse,
} from '../dto/booking-response.dto';
import { ExternalIdentitiesService } from '../../external-identities/external-identities.service';
import { Booking } from '../entities/booking.entity';
import { addMinutes } from '../domain/time';
import { BookingsRepository } from '../repositories/bookings.repository';
import {
  BookingActivityService,
  BookingRoutingKey,
} from './booking-activity.service';
import { BookingCancellationService } from './booking-cancellation.service';
import { BookingQrService } from './booking-qr.service';
import { BookingRulesService } from './booking-rules.service';

export type BookingScope = 'booking' | 'group';

const IDEMPOTENCY_KEY_MAX = 100;
const IDEMPOTENCY_UK = 'bookings_user_idempotency_uk';

/**
 * Reserve, modify, extend and cancel. Each runs in ONE transaction with its
 * booking_events, notifications and outbox_events rows (AGENTS.md section 6.11).
 * Overlaps are rejected by the database exclusion constraint only.
 */
/** The times a pending alert's message shows, after its booking moved. */
function rangeTimes(range: TimeRange): { startAt: string; endAt: string } {
  return { startAt: range.start.toISOString(), endAt: range.end.toISOString() };
}

@Injectable()
export class BookingsService {
  // Forwards to AppLogger (main.ts). One line per committed change, logged after
  // the transaction so a rolled-back change is never reported. Ids only: no
  // emails, QR secrets or Idempotency-Keys.
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly bookings: BookingsRepository,
    private readonly rules: BookingRulesService,
    private readonly activity: BookingActivityService,
    private readonly qr: BookingQrService,
    private readonly notifications: NotificationsService,
    private readonly cancellation: BookingCancellationService,
    @Inject(SEAT_LOOKUP) private readonly seats: SeatLookupPort,
    @Inject(PLACE_RULES) private readonly placeRules: PlaceRulesPort,
    private readonly identities: ExternalIdentitiesService,
  ) {}

  /**
   * Books one or more seats of the same place for the same time, all-or-nothing.
   * A repeated call with the same Idempotency-Key returns the original group.
   */
  async create(
    user: AuthUser,
    dto: CreateBookingDto,
    idempotencyKey?: string,
  ): Promise<BookingGroupResponseDto> {
    const key = this.normalizeKey(idempotencyKey);
    if (key) {
      const existing = await this.bookings.findByIdempotencyKey(user.id, key);
      if (existing) return this.replay(existing, dto);
    }

    const seatIds = dto.seatIds;
    if (new Set(seatIds).size !== seatIds.length) {
      throw new BadRequestException('The same seat is listed twice');
    }
    const range: TimeRange = {
      start: new Date(dto.startAt),
      end: new Date(dto.endAt),
    };
    const now = new Date();

    let groupId: string;
    try {
      groupId = await this.dataSource.transaction(async (manager) => {
        await this.bookings.lockUser(manager, user.id);

        const found = await this.seats.findBookable(seatIds, manager);
        if (found.length !== seatIds.length) {
          throw new NotFoundException(
            'One or more seats do not exist or cannot be booked',
          );
        }
        if (new Set(found.map((s) => s.placeId)).size > 1) {
          throw new BadRequestException(
            'All seats in one booking must be in the same place',
          );
        }
        // Keep the caller's order (the first seat carries the idempotency key).
        const seats = seatIds.map((id) => found.find((s) => s.id === id)!);

        const ctx = await this.placeRules.getBookingContext(
          seats[0].placeId,
          manager,
        );
        if (ctx.externalSystem)
          await this.assertPartnerEligibility(manager, user.id, ctx.externalSystem, ctx.timezone, now);
        this.rules.validateNewRange(range, ctx.policy, now, ctx.timezone);
        if (
          !(await this.placeRules.isOpenForRange(ctx.placeId, range, manager))
        ) {
          throw new BadRequestException(
            'The place is closed during part of this time',
          );
        }
        const active = await this.bookings.countActiveForUser(
          manager,
          user.id,
          ctx.placeId,
        );
        if (active + seats.length > ctx.policy.maxActivePerUser) {
          throw new ConflictException(
            `You can have at most ${ctx.policy.maxActivePerUser} active bookings at this place`,
          );
        }

        const newGroupId = randomUUID();
        const inserted = await this.bookings.insert(
          manager,
          seats.map((seat, i) => ({
            seatId: seat.id,
            userId: user.id,
            source: BookingSource.APP,
            timeRange: range,
            status: BookingStatus.PENDING,
            groupId: newGroupId,
            // The partial unique index allows the key on one row per user.
            idempotencyKey: i === 0 ? key : null,
          })),
        );
        // Reload with seat + place joined (outbox payload and alert texts need them).
        const created = await this.bookings.findByIds(
          inserted.map((b) => b.id),
          manager,
        );

        await this.activity.record(manager, created, {
          event: BookingEventType.CREATED,
          routingKey: BookingRoutingKey.CREATED,
          actor: { userId: user.id },
        });
        await this.notifications.schedule(
          manager,
          created.flatMap((b) =>
            this.activity.initialAlerts(
              b,
              this.activity.alertPayload(b, b.seat, b.seat.place, ctx.policy),
              ctx.policy,
              now,
            ),
          ),
        );
        return newGroupId;
      });
    } catch (err) {
      // A concurrent retry with the same key won the race: return its booking.
      if (key && isPgError(err, PG_UNIQUE_VIOLATION, IDEMPOTENCY_UK)) {
        const existing = await this.bookings.findByIdempotencyKey(user.id, key);
        if (existing) return this.replay(existing, dto);
      }
      throw err;
    }
    this.logger.log(
      `Booking created: group=${groupId} seats=${seatIds.length} user=${user.id}`,
    );
    return this.groupResponse(groupId);
  }

  async listMine(
    user: AuthUser,
    query: MyBookingsQueryDto,
  ): Promise<PaginatedBookingsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.bookings.listForUser(
      user.id,
      query.view ?? 'all',
      page,
      limit,
    );
    return { items: items.map(toBookingResponse), page, limit, total };
  }

  async getMine(
    user: AuthUser,
    bookingId: string,
  ): Promise<BookingResponseDto> {
    return toBookingResponse(await this.findOwned(user, bookingId));
  }

  /** Changes date/time. Only PENDING, before start - modify_cutoff_minutes. */
  async modify(
    user: AuthUser,
    bookingId: string,
    dto: ModifyBookingDto,
    scope: BookingScope,
  ): Promise<BookingGroupResponseDto> {
    const range: TimeRange = {
      start: new Date(dto.startAt),
      end: new Date(dto.endAt),
    };
    const now = new Date();

    const target = await this.dataSource.transaction(async (manager) => {
      const targets = await this.loadTargets(manager, user, bookingId, scope);
      const ctx = await this.placeRules.getBookingContext(
        targets[0].seat.placeId,
        manager,
      );
      for (const b of targets) this.rules.validateModify(b, ctx.policy, now);
      await this.assertSeatsStillBookable(targets);
      // A member suspended by the partner can't move a booking to a new time either.
      if (ctx.externalSystem)
        await this.assertPartnerEligibility(manager, user.id, ctx.externalSystem, ctx.timezone, now);
      this.rules.validateNewRange(range, ctx.policy, now, ctx.timezone);
      if (
        !(await this.placeRules.isOpenForRange(ctx.placeId, range, manager))
      ) {
        throw new BadRequestException(
          'The place is closed during part of this time',
        );
      }

      const oldRanges = new Map(targets.map((b) => [b.id, b.timeRange]));
      // Any overlap with another booking -> 23P01 -> 409, and the whole group rolls back.
      for (const b of targets)
        await this.bookings.updateRange(manager, b, range);

      const ids = targets.map((b) => b.id);
      // Codes carry the old window in expires_at; the user fetches new ones.
      await this.qr.revokeLive(manager, ids);
      await this.notifications.reschedule(
        manager,
        ids,
        NotificationType.LATE_CHECKIN,
        this.activity.lateCheckinAt(range, ctx.policy),
        {
          ...rangeTimes(range),
          checkinDeadline: addMinutes(
            range.start,
            ctx.policy.checkinGraceMinutes,
          ).toISOString(),
        },
      );
      await this.rescheduleReminder(manager, targets, range, ctx.policy);
      await this.scheduleChangeAlert(
        manager,
        targets,
        NotificationType.BOOKING_MODIFIED,
        oldRanges,
        now,
      );
      await this.activity.record(manager, targets, {
        event: BookingEventType.MODIFIED,
        routingKey: BookingRoutingKey.MODIFIED,
        actor: { userId: user.id },
        oldRanges,
      });
      return targets[0];
    });
    this.logger.log(
      `Booking modified: booking=${target.id} group=${target.groupId ?? '-'} scope=${scope} user=${user.id}`,
    );
    return this.groupResponse(
      target,
      scope === 'booking' ? [target.id] : undefined,
    );
  }

  /** Moves the end later (PENDING or CHECKED_IN), up to booking_policies.max_extensions. */
  async extend(
    user: AuthUser,
    bookingId: string,
    dto: ExtendBookingDto,
    scope: BookingScope,
  ): Promise<BookingGroupResponseDto> {
    const newEnd = new Date(dto.endAt);
    const now = new Date();

    const target = await this.dataSource.transaction(async (manager) => {
      const targets = await this.loadTargets(manager, user, bookingId, scope);
      const ctx = await this.placeRules.getBookingContext(
        targets[0].seat.placeId,
        manager,
      );

      await this.assertSeatsStillBookable(targets);

      const oldRanges = new Map(targets.map((b) => [b.id, b.timeRange]));
      for (const b of targets) {
        const range = this.rules.validateExtend(
          b,
          newEnd,
          ctx.policy,
          now,
          ctx.timezone,
        );
        if (
          !(await this.placeRules.isOpenForRange(ctx.placeId, range, manager))
        ) {
          throw new BadRequestException(
            'The place is closed during part of this time',
          );
        }
        await this.bookings.updateRange(
          manager,
          b,
          range,
          b.extensionCount + 1,
        );
        await this.rescheduleReminder(manager, [b], range, ctx.policy);
      }

      await this.scheduleChangeAlert(
        manager,
        targets,
        NotificationType.BOOKING_EXTENDED,
        oldRanges,
        now,
      );
      await this.activity.record(manager, targets, {
        event: BookingEventType.EXTENDED,
        routingKey: BookingRoutingKey.EXTENDED,
        actor: { userId: user.id },
        oldRanges,
      });
      return targets[0];
    });
    this.logger.log(
      `Booking extended: booking=${target.id} group=${target.groupId ?? '-'} scope=${scope} user=${user.id}`,
    );
    return this.groupResponse(
      target,
      scope === 'booking' ? [target.id] : undefined,
    );
  }

  /** The user cancels (PENDING, before the cutoff). The row is kept; the seat frees up. */
  async cancel(
    user: AuthUser,
    bookingId: string,
    dto: CancelBookingDto,
    scope: BookingScope,
  ): Promise<BookingGroupResponseDto> {
    const now = new Date();
    const target = await this.dataSource.transaction(async (manager) => {
      const targets = await this.loadTargets(manager, user, bookingId, scope);
      const ctx = await this.placeRules.getBookingContext(
        targets[0].seat.placeId,
        manager,
      );
      for (const b of targets)
        this.rules.validateUserCancel(b, ctx.policy, now);
      await this.cancellation.cancel(
        manager,
        targets,
        { userId: user.id },
        dto.reason ?? null,
        now,
        'USER_CANCELLED',
      );
      return targets[0];
    });
    this.logger.log(
      `Booking cancelled: booking=${target.id} group=${target.groupId ?? '-'} scope=${scope} user=${user.id}`,
    );
    return this.groupResponse(
      target,
      scope === 'booking' ? [target.id] : undefined,
    );
  }

  // ---- admin ----

  async listAll(
    query: AdminBookingsQueryDto,
  ): Promise<PaginatedBookingsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.bookings.listAdmin(
      {
        status: query.status,
        userId: query.userId,
        seatId: query.seatId,
        placeId: query.placeId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      page,
      limit,
    );
    return { items: items.map(toBookingResponse), page, limit, total };
  }

  async getAnyWithEvents(
    bookingId: string,
  ): Promise<AdminBookingDetailResponseDto> {
    const booking = await this.bookings.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    const events = await this.bookings.findEvents(bookingId);
    return {
      ...toBookingResponse(booking),
      events: events.map(toBookingEventResponse),
    };
  }

  /** Admin cancel: any PENDING booking, no cutoff. */
  async adminCancel(
    admin: AuthUser,
    bookingId: string,
    reason: string | null,
  ): Promise<BookingResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.bookings.findById(bookingId, manager, true);
      if (!booking) throw new NotFoundException('Booking not found');
      await this.cancellation.cancel(
        manager,
        [booking],
        { userId: admin.id },
        reason,
        new Date(),
        'ADMIN_CANCELLED',
      );
    });
    this.logger.log(
      `Booking cancelled by admin: booking=${bookingId} admin=${admin.id}`,
    );
    return toBookingResponse((await this.bookings.findById(bookingId))!);
  }

  /**
   * System cancellation because the partner (LMS) changed the place: seat
   * removed, hours or closures changed, place closed (docs/lms-integration-proposal.md
   * section 6.1, D4). Runs on the caller's transaction (the place sync).
   */
  cancelForPartnerChange(
    manager: EntityManager,
    cancellations: { bookingId: string; subReason: string }[],
    now: Date,
  ): Promise<number> {
    return this.cancellation.cancelForPlaceChange(
      manager,
      cancellations,
      now,
      'LIBRARY_PLACE_CHANGED',
    );
  }

  // ---- helpers ----

  /**
   * 409 if any seat went into maintenance, was deleted, or its place closed
   * since booking. Deliberately outside the transaction (no `manager`): with
   * one, findBookable locks the seat FOR SHARE, and while this transaction
   * already holds the booking row that could deadlock with an admin seat
   * change (which locks the seat, then the booking). The booking row lock
   * already makes such an admin change wait for this one and then cancel it.
   */
  private async assertSeatsStillBookable(targets: Booking[]): Promise<void> {
    const seatIds = [...new Set(targets.map((b) => b.seatId))];
    const found = await this.seats.findBookable(seatIds);
    if (found.length !== seatIds.length) {
      throw new ConflictException(
        'One or more seats of this booking can no longer be booked',
      );
    }
  }

  /**
   * Idempotent replay: the same key must come with the same request. A
   * different body under a reused key is a client bug, so 422 instead of
   * silently returning the old booking (the Stripe convention). The original
   * range is the old range of the first MODIFIED/EXTENDED event, else the
   * current one, so a retry still matches after the booking was changed.
   */
  private async replay(
    existing: Booking,
    dto: CreateBookingDto,
  ): Promise<BookingGroupResponseDto> {
    const group = existing.groupId
      ? await this.bookings.findGroup(existing.groupId)
      : [existing];
    const sameSeats =
      group.length === dto.seatIds.length &&
      dto.seatIds.every((id) => group.some((b) => b.seatId === id));
    const firstChange = (await this.bookings.findEvents(existing.id)).find(
      (e) =>
        e.type === BookingEventType.MODIFIED ||
        e.type === BookingEventType.EXTENDED,
    );
    const original = firstChange?.oldRange ?? existing.timeRange;
    const sameRange =
      original.start.getTime() === new Date(dto.startAt).getTime() &&
      original.end.getTime() === new Date(dto.endAt).getTime();
    if (!sameSeats || !sameRange) {
      throw new UnprocessableEntityException(
        'Idempotency-Key was already used with a different request',
      );
    }
    return this.groupResponse(existing);
  }

  /**
   * New bookings at a partner-managed place need the user's linked partner
   * account in good standing (LMS member.standing_changed, decision D10).
   * Users who never linked are not restricted. Existing bookings are kept.
   */
  private async assertPartnerEligibility(
    manager: EntityManager,
    userId: string,
    system: string,
    timezone: string,
    now: Date,
  ): Promise<void> {
    // en-CA formats as YYYY-MM-DD: the place-local date to compare with the expiry date.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
    const result = await this.identities.eligibility(manager, system, userId, today);
    if (result && !result.eligible)
      throw new ForbiddenException(
        `Your library membership does not allow booking here (${result.reasons.join(', ') || 'not eligible'})`,
      );
  }

  /** Immediate "your booking changed" alert, showing the range before and after. */
  private scheduleChangeAlert(
    manager: EntityManager,
    targets: Booking[],
    type: NotificationType.BOOKING_MODIFIED | NotificationType.BOOKING_EXTENDED,
    oldRanges: Map<string, TimeRange>,
    now: Date,
  ): Promise<void> {
    return this.notifications.schedule(
      manager,
      targets.map((b) => {
        const before = oldRanges.get(b.id);
        return {
          userId: b.userId,
          bookingId: b.id,
          type,
          scheduledAt: now,
          payload: {
            ...this.activity.alertPayload(b, b.seat, b.seat.place),
            ...(before
              ? {
                  previousStartAt: before.start.toISOString(),
                  previousEndAt: before.end.toISOString(),
                }
              : {}),
          },
        };
      }),
    );
  }

  /**
   * The checkout reminder follows the new end: re-armed even if the old one was
   * already sent (extend after the 10:45 reminder of a 10-11 booking), and
   * created if the booking used to be too short for one. `targets` already
   * carry the new range.
   */
  private async rescheduleReminder(
    manager: EntityManager,
    targets: Booking[],
    range: TimeRange,
    policy: Parameters<BookingActivityService['checkoutReminderAt']>[1],
  ): Promise<void> {
    const at = this.activity.checkoutReminderAt(range, policy);
    if (at) {
      await this.notifications.rearm(
        manager,
        targets.map((b) => ({
          userId: b.userId,
          bookingId: b.id,
          type: NotificationType.CHECKOUT_REMINDER,
          scheduledAt: at,
          payload: this.activity.alertPayload(b, b.seat, b.seat.place, policy),
        })),
      );
    } else {
      await this.notifications.skipPending(
        manager,
        targets.map((b) => b.id),
        [NotificationType.CHECKOUT_REMINDER],
      );
    }
  }

  /** The booking (locked), or its whole group for scope=group. Others' bookings -> 404. */
  private async loadTargets(
    manager: EntityManager,
    user: AuthUser,
    bookingId: string,
    scope: BookingScope,
  ): Promise<Booking[]> {
    const booking = await this.bookings.findById(bookingId, manager, true);
    if (!booking || booking.userId !== user.id) {
      throw new NotFoundException('Booking not found');
    }
    if (scope === 'booking' || !booking.groupId) return [booking];
    // Seats already finished (e.g. one cancelled earlier) are left alone.
    const group = (
      await this.bookings.findGroup(booking.groupId, manager, true)
    ).filter((b) => b.userId === user.id && b.status === booking.status);
    return group.length > 0 ? group : [booking];
  }

  private async findOwned(user: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.bookings.findById(bookingId);
    // 404, not 403: don't reveal that someone else's booking id exists.
    if (!booking || booking.userId !== user.id) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  /** The whole group, or only `onlyIds` of it. */
  private async groupResponse(
    groupOrBooking: string | Booking,
    onlyIds?: string[],
  ): Promise<BookingGroupResponseDto> {
    const groupId =
      typeof groupOrBooking === 'string'
        ? groupOrBooking
        : (groupOrBooking.groupId ?? groupOrBooking.id);
    let bookings = await this.bookings.findGroup(groupId);
    if (bookings.length === 0 && typeof groupOrBooking !== 'string') {
      bookings = [groupOrBooking];
    }
    if (onlyIds) bookings = bookings.filter((b) => onlyIds.includes(b.id));
    return { groupId, bookings: bookings.map(toBookingResponse) };
  }

  private normalizeKey(key: string | undefined): string | null {
    const trimmed = key?.trim();
    if (!trimmed) return null;
    if (trimmed.length > IDEMPOTENCY_KEY_MAX) {
      throw new BadRequestException(
        `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX} characters`,
      );
    }
    return trimmed;
  }
}

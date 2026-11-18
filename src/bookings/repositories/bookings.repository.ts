import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager, In, SelectQueryBuilder } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import { BookingStatus, SeatStatus } from '../../common/enums';
import {
  isPgError,
  PG_DEADLOCK_DETECTED,
  PG_EXCLUSION_VIOLATION,
  PG_SERIALIZATION_FAILURE,
} from '../../common/utils/db-errors';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import {
  ACTIVE_STATUSES,
  FINISHED_STATUSES,
  SEAT_HOLDING_STATUSES,
} from '../domain/booking-state';
import { BookingEvent } from '../entities/booking-event.entity';
import { Booking } from '../entities/booking.entity';
import { Seat } from '../../seats/entities/seat.entity';
import { SortOrder, type SortQuery } from '../../common/dto/pagination-query.dto';
import { applySort, pageOffset, type SortSpec } from '../../common/utils/pagination';
import type { BookingSortField } from '../dto/booking-request.dto';

interface PageQuery {
  page: number;
  limit: number;
}

export type BookingListView = 'all' | 'upcoming' | 'history';

/** Filters of the user's own booking list. */
export interface BookingListFilters {
  status?: BookingStatus;
  placeId?: string;
  /** Bookings overlapping [from, to); either side may be open. */
  from?: Date;
  to?: Date;
}

export interface AdminBookingFilters extends BookingListFilters {
  userId?: string;
  seatId?: string;
}

/** `sortBy` -> SQL. lower(time_range) is the booking start. */
const BOOKING_SORT_COLUMNS: SortSpec<BookingSortField>['columns'] = {
  startAt: 'lower(b.time_range)',
  createdAt: 'b.createdAt',
};

/** Default order per list: newest first for "all", soonest first for upcoming. */
const BOOKING_DEFAULT_SORT: Record<
  BookingListView | 'admin',
  SortSpec<BookingSortField>['default']
> = {
  all: { sortBy: 'createdAt', order: SortOrder.DESC },
  upcoming: { sortBy: 'startAt', order: SortOrder.ASC },
  history: { sortBy: 'startAt', order: SortOrder.DESC },
  admin: { sortBy: 'startAt', order: SortOrder.DESC },
};

function bookingSort(list: BookingListView | 'admin'): SortSpec<BookingSortField> {
  return {
    columns: BOOKING_SORT_COLUMNS,
    default: BOOKING_DEFAULT_SORT[list],
    tieBreaker: 'b.id',
  };
}

/** Filters shared by the user's and the admin's lists (query aliases b, s). */
function applyListFilters(
  qb: SelectQueryBuilder<Booking>,
  filters: BookingListFilters,
): void {
  if (filters.status) qb.andWhere('b.status = :status', { status: filters.status });
  if (filters.placeId) qb.andWhere('s.placeId = :placeId', { placeId: filters.placeId });
  if (filters.from || filters.to) {
    // Unbounded side = -infinity / infinity.
    qb.andWhere(`b.time_range && tstzrange(:from, :to, '[)')`, {
      from: filters.from?.toISOString() ?? null,
      to: filters.to?.toISOString() ?? null,
    });
  }
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface UserBookingCounts {
  total: number;
  upcoming: number;
  active: number;
  completed: number;
  cancelled: number;
  expired: number;
  hoursBooked: number;
  favouritePlace: { id: string; name: string; bookings: number } | null;
}

export interface UserBookingEventRow {
  id: string;
  bookingId: string;
  type: string;
  createdAt: Date;
  actorUserId: string | null;
  byClient: boolean;
  bySystem: boolean;
  bookingUserId: string;
  placeName: string;
  seatLabel: string;
}

/** The exclusion constraint is the only double-booking check (AGENTS.md section 6.1). */
function mapConflict(err: unknown): unknown {
  // Under heavy concurrency Postgres may abort one of two conflicting inserts
  // with a deadlock/serialization error rather than 23P01. It is the same
  // "another request won" outcome for the caller, so still 409.
  const conflict =
    isPgError(err, PG_EXCLUSION_VIOLATION) ||
    isPgError(err, PG_DEADLOCK_DETECTED) ||
    isPgError(err, PG_SERIALIZATION_FAILURE);
  return conflict
    ? new ConflictException('This seat is already booked for that time')
    : err;
}

/**
 * All bookings data access, including every tstzrange query (AGENTS.md
 * section 7). Exported for the jobs and admin modules.
 */
@Injectable()
export class BookingsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private manager(manager?: EntityManager): EntityManager {
    return manager ?? this.dataSource.manager;
  }

  /**
   * Bookings with their seat and place (labels and timezone for responses and
   * alerts). withDeleted: history must still show soft-deleted seats.
   */
  private query(manager?: EntityManager): SelectQueryBuilder<Booking> {
    return this.manager(manager)
      .getRepository(Booking)
      .createQueryBuilder('b')
      .withDeleted()
      .innerJoinAndSelect('b.seat', 's')
      .innerJoinAndSelect('s.place', 'p');
  }

  /** Lock only the booking rows (FOR UPDATE OF b), never the joined seat or place. */
  private lock(qb: SelectQueryBuilder<Booking>): SelectQueryBuilder<Booking> {
    return qb.setLock('pessimistic_write', undefined, ['b']);
  }

  async insert(manager: EntityManager, rows: DeepPartial<Booking>[]): Promise<Booking[]> {
    const repo = manager.getRepository(Booking);
    try {
      return await repo.save(repo.create(rows));
    } catch (err) {
      throw mapConflict(err);
    }
  }

  findById(id: string, manager?: EntityManager, forUpdate = false): Promise<Booking | null> {
    const qb = this.query(manager).where('b.id = :id', { id });
    return (forUpdate ? this.lock(qb) : qb).getOne();
  }

  findByIds(ids: string[], manager?: EntityManager): Promise<Booking[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.query(manager)
      .where('b.id IN (:...ids)', { ids })
      .orderBy('s.label', 'ASC')
      .getMany();
  }

  findGroup(groupId: string, manager?: EntityManager, forUpdate = false): Promise<Booking[]> {
    const qb = this.query(manager)
      .where('b.groupId = :groupId', { groupId })
      .orderBy('s.label', 'ASC');
    return (forUpdate ? this.lock(qb) : qb).getMany();
  }

  findByIdempotencyKey(userId: string, key: string): Promise<Booking | null> {
    return this.query()
      .where('b.userId = :userId AND b.idempotencyKey = :key', { userId, key })
      .getOne();
  }

  /**
   * Serializes one user's concurrent creates so the max_active_per_user count
   * can't be raced. Locks only the user's row; other users are unaffected.
   */
  /**
   * Locks the user row, serialising booking creation with account deletion
   * (which takes the same lock), and refuses a deleted account whose access
   * token hasn't expired yet.
   */
  async lockUser(manager: EntityManager, userId: string): Promise<void> {
    const rows: { deleted: boolean }[] | undefined = await manager.query(
      'SELECT deleted_at IS NOT NULL AS deleted FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    if (rows?.[0]?.deleted) throw new ForbiddenException('Account is closed');
  }

  /** The user's PENDING bookings, locked (account closure cancels them). */
  async lockPendingForUser(manager: EntityManager, userId: string): Promise<Booking[]> {
    const rows: { id: string }[] = await manager.query(
      `SELECT id FROM bookings
        WHERE user_id = $1 AND status = 'PENDING'
        ORDER BY lower(time_range)
        FOR UPDATE`,
      [userId],
    );
    return this.findByIds(rows.map((r) => r.id), manager);
  }

  /** True while the user occupies a seat (CHECKED_IN or CHECKOUT_OVERDUE). */
  async hasSeatInUse(manager: EntityManager, userId: string): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM bookings
        WHERE user_id = $1 AND status IN ('CHECKED_IN', 'CHECKOUT_OVERDUE')
        LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }

  /** Per-seat booking counts and completed hours for one user. */
  async summaryForUser(userId: string, now: Date): Promise<UserBookingCounts> {
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'PENDING' AND lower(time_range) > $2)::int AS upcoming,
              count(*) FILTER (WHERE status IN ('CHECKED_IN', 'CHECKOUT_OVERDUE'))::int AS active,
              count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE status = 'EXPIRED')::int AS expired,
              coalesce(sum(extract(epoch FROM upper(time_range) - lower(time_range)))
                FILTER (WHERE status = 'COMPLETED'), 0)::float / 3600 AS "hoursBooked"
         FROM bookings WHERE user_id = $1`,
      [userId, now],
    );
    const [fav] = await this.dataSource.query(
      `SELECT p.id, p.name, count(*)::int AS bookings
         FROM bookings b
         JOIN seats s ON s.id = b.seat_id
         JOIN places p ON p.id = s.place_id
        WHERE b.user_id = $1 AND b.status NOT IN ('CANCELLED', 'EXPIRED')
        GROUP BY p.id, p.name
        ORDER BY count(*) DESC, p.name ASC
        LIMIT 1`,
      [userId],
    );
    return { ...row, favouritePlace: fav ?? null };
  }

  /**
   * Booking events about the user's bookings or done by the user (e.g. an
   * admin's check-ins), newest first.
   */
  async eventsForUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<Page<UserBookingEventRow>> {
    const where = 'WHERE b.user_id = $1 OR e.actor_user_id = $1';
    const items: UserBookingEventRow[] = await this.dataSource.query(
      `SELECT e.id, e.booking_id AS "bookingId", e.type, e.created_at AS "createdAt",
              e.actor_user_id AS "actorUserId", e.actor_client_id IS NOT NULL AS "byClient",
              e.actor_system AS "bySystem", b.user_id AS "bookingUserId",
              p.name AS "placeName", s.label AS "seatLabel"
         FROM booking_events e
         JOIN bookings b ON b.id = e.booking_id
         JOIN seats s ON s.id = b.seat_id
         JOIN places p ON p.id = s.place_id
        ${where}
        ORDER BY e.created_at DESC, e.id ASC
        LIMIT $2 OFFSET $3`,
      [userId, limit, pageOffset({ page, limit })],
    );
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM booking_events e
         JOIN bookings b ON b.id = e.booking_id ${where}`,
      [userId],
    );
    return { items, total };
  }

  /** The user's active bookings at one place (max_active_per_user is a per-place policy). */
  countActiveForUser(
    manager: EntityManager,
    userId: string,
    placeId: string,
  ): Promise<number> {
    return (
      manager
        .getRepository(Booking)
        .createQueryBuilder('b')
        // A soft-deleted seat's live bookings still count.
        .withDeleted()
        .innerJoin('b.seat', 's')
        .where('b.userId = :userId', { userId })
        .andWhere('s.placeId = :placeId', { placeId })
        .andWhere('b.status IN (:...active)', { active: [...ACTIVE_STATUSES] })
        .getCount()
    );
  }

  /**
   * True when a no-show must not be counted for this group: another of its
   * bookings already expired in an earlier run (counted then), or one was
   * attended. `batchIds` (this run's expiring rows) are left out. The
   * transaction-scoped advisory lock makes a concurrent job run on another
   * instance wait, so it sees this run's EXPIRED rows once committed.
   */
  async noShowAlreadySettled(
    manager: EntityManager,
    groupId: string,
    batchIds: string[],
  ): Promise<boolean> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('no-show:' || $1))`, [groupId]);
    const [row]: { settled: boolean }[] = await manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM bookings
          WHERE group_id = $1
            AND NOT (id = ANY($2::uuid[]))
            AND status IN ('EXPIRED', 'CHECKED_IN', 'CHECKOUT_OVERDUE', 'COMPLETED')
       ) AS settled`,
      [groupId, batchIds],
    );
    return row.settled;
  }

  /**
   * Changes the range with an optimistic version check. The exclusion
   * constraint guards the UPDATE too: an overlap is 23P01 -> 409.
   */
  async updateRange(
    manager: EntityManager,
    booking: Booking,
    range: TimeRange,
    extensionCount: number = booking.extensionCount,
  ): Promise<void> {
    let affected: number | undefined;
    try {
      const result = await manager
        .createQueryBuilder()
        .update(Booking)
        .set({
          // The column transformer turns this into '[start,end)'.
          timeRange: range,
          extensionCount,
          version: () => 'version + 1',
        })
        .where('id = :id AND version = :version', {
          id: booking.id,
          version: booking.version,
        })
        .execute();
      affected = result.affected;
    } catch (err) {
      throw mapConflict(err);
    }
    if (!affected) {
      throw new ConflictException('The booking was changed by another request; reload and retry');
    }
    booking.timeRange = range;
    booking.extensionCount = extensionCount;
    booking.version += 1;
  }

  /** Status / attendance columns. Bumps `version` so stale modify/extend calls fail. */
  async updateFields(
    manager: EntityManager,
    ids: string[],
    fields: QueryDeepPartialEntity<Booking>,
  ): Promise<void> {
    if (ids.length === 0) return;
    await manager
      .createQueryBuilder()
      .update(Booking)
      .set({ ...fields, version: () => 'version + 1' })
      .where({ id: In(ids) })
      .execute();
  }

  async listForUser(
    userId: string,
    view: BookingListView,
    filters: BookingListFilters,
    sort: SortQuery<BookingSortField>,
    page: PageQuery,
  ): Promise<Page<Booking>> {
    const qb = this.query().where('b.userId = :userId', { userId });
    if (view === 'upcoming') {
      qb.andWhere('b.status IN (:...holding)', { holding: SEAT_HOLDING_STATUSES });
    } else if (view === 'history') {
      qb.andWhere('b.status IN (:...finished)', { finished: FINISHED_STATUSES });
    }
    applyListFilters(qb, filters);
    return this.page(applySort(qb, sort, bookingSort(view)), page);
  }

  async listAdmin(
    filters: AdminBookingFilters,
    sort: SortQuery<BookingSortField>,
    page: PageQuery,
  ): Promise<Page<Booking>> {
    const qb = this.query();
    if (filters.userId) qb.andWhere('b.userId = :userId', { userId: filters.userId });
    if (filters.seatId) qb.andWhere('b.seatId = :seatId', { seatId: filters.seatId });
    applyListFilters(qb, filters);
    return this.page(applySort(qb, sort, bookingSort('admin')), page);
  }

  private async page(
    qb: SelectQueryBuilder<Booking>,
    page: PageQuery,
  ): Promise<Page<Booking>> {
    const [items, total] = await qb
      // offset/limit, not skip/take: the joins are many-to-one so rows never
      // multiply, and skip/take's DISTINCT subquery breaks ORDER BY lower(...).
      .offset(pageOffset(page))
      .limit(page.limit)
      .getManyAndCount();
    return { items, total };
  }

  findEvents(bookingId: string): Promise<BookingEvent[]> {
    return this.dataSource.manager.getRepository(BookingEvent).find({
      where: { bookingId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * PENDING bookings not checked in by start + checkin_grace_minutes, locked
   * with SKIP LOCKED so several app instances can run the job safely. Joins the
   * place's policy because the grace period is per place.
   */
  async claimExpirable(manager: EntityManager, now: Date, limit: number): Promise<Booking[]> {
    const rows: { id: string }[] = await manager.query(
      `SELECT b.id
         FROM bookings b
         JOIN seats s ON s.id = b.seat_id
         JOIN booking_policies p ON p.place_id = s.place_id
        WHERE b.status = 'PENDING'
          AND lower(b.time_range) + make_interval(mins => p.checkin_grace_minutes) <= $1
        ORDER BY lower(b.time_range)
        LIMIT $2
        FOR UPDATE OF b SKIP LOCKED`,
      [now, limit],
    );
    return this.findByIds(rows.map((r) => r.id), manager);
  }

  /**
   * PENDING bookings at a place that start after `now`, locked (FOR UPDATE OF b).
   * The partner place sync checks them against the new layout and hours.
   */
  async lockFuturePendingAtPlace(
    manager: EntityManager,
    placeId: string,
    now: Date,
  ): Promise<Booking[]> {
    const rows: { id: string }[] = await manager.query(
      `SELECT b.id
         FROM bookings b
         JOIN seats s ON s.id = b.seat_id
        WHERE s.place_id = $1
          AND b.status = 'PENDING'
          AND lower(b.time_range) > $2
        ORDER BY lower(b.time_range)
        FOR UPDATE OF b`,
      [placeId, now],
    );
    return this.findByIds(rows.map((r) => r.id), manager);
  }

  /**
   * Seats of a place free for the whole range (docs/erd.md section 7): ACTIVE,
   * not deleted, and no PENDING / CHECKED_IN / CHECKOUT_OVERDUE booking
   * overlapping it (the statuses of no_double_booking). If the range includes
   * `now`, a seat with any CHECKOUT_OVERDUE booking is occupied too: its user
   * may still be sitting there. The caller checks the place itself
   * (active, partner-open, opening hours).
   */
  async findAvailableSeats(
    placeId: string,
    range: TimeRange,
    now: Date,
    opts: { areaId?: string; page: number; limit: number },
  ): Promise<Page<Seat>> {
    const includesNow = range.start <= now && now < range.end;
    const qb = this.dataSource.manager
      .getRepository(Seat)
      .createQueryBuilder('seat')
      .where('seat.placeId = :placeId', { placeId })
      .andWhere('seat.status = :active', { active: SeatStatus.ACTIVE })
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM bookings b
            WHERE b.seat_id = seat.id
              AND b.status IN (:...holding)
              AND (b.time_range && tstzrange(:start, :end, '[)')
                   ${includesNow ? "OR b.status = 'CHECKOUT_OVERDUE'" : ''}))`,
        {
          holding: SEAT_HOLDING_STATUSES,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
      );
    if (opts.areaId) qb.andWhere('seat.areaId = :areaId', { areaId: opts.areaId });
    const [items, total] = await qb
      .orderBy('seat.label')
      .addOrderBy('seat.id')
      .skip(pageOffset(opts))
      .take(opts.limit)
      .getManyAndCount();
    return { items, total };
  }

  /** Ranges of a seat's PENDING / CHECKED_IN / CHECKOUT_OVERDUE bookings overlapping `range`. */
  async busyRanges(seatId: string, range: TimeRange): Promise<TimeRange[]> {
    const rows = await this.dataSource.manager
      .getRepository(Booking)
      .createQueryBuilder('b')
      .select(['b.id', 'b.timeRange'])
      .where('b.seatId = :seatId', { seatId })
      .andWhere('b.status IN (:...holding)', { holding: SEAT_HOLDING_STATUSES })
      .andWhere(`b.time_range && tstzrange(:start, :end, '[)')`, {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      })
      .orderBy('lower(b.time_range)', 'ASC')
      .getMany();
    return rows.map((b) => b.timeRange);
  }

  /** Occupied now (docs/erd.md section 7): CHECKED_IN containing now, or any CHECKOUT_OVERDUE. */
  async isOccupiedNow(seatId: string, now: Date): Promise<boolean> {
    const [row]: { occupied: boolean }[] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM bookings
          WHERE seat_id = $1
            AND (status = 'CHECKOUT_OVERDUE'
                 OR (status = 'CHECKED_IN' AND time_range @> $2::timestamptz))
       ) AS occupied`,
      [seatId, now],
    );
    return row.occupied;
  }

  /**
   * Every PENDING booking at a place (or on one seat of it), locked. Unlike
   * lockFuturePendingAtPlace this includes bookings already inside their
   * check-in grace window: after an admin closes the seat they would
   * otherwise expire as no-shows the user didn't cause.
   */
  async lockPendingAtPlace(
    manager: EntityManager,
    placeId: string,
    seatId?: string,
  ): Promise<Booking[]> {
    const rows: { id: string }[] = await manager.query(
      `SELECT b.id
         FROM bookings b
         JOIN seats s ON s.id = b.seat_id
        WHERE s.place_id = $1
          AND ($2::uuid IS NULL OR b.seat_id = $2::uuid)
          AND b.status = 'PENDING'
        ORDER BY lower(b.time_range)
        FOR UPDATE OF b`,
      [placeId, seatId ?? null],
    );
    return this.findByIds(rows.map((r) => r.id), manager);
  }

  /**
   * CHECKED_IN bookings still not checked out at end + overdue_alert_minutes
   * (booking 10:00-11:00 -> overdue at 11:15 with the default policy).
   */
  async claimOverdue(manager: EntityManager, now: Date, limit: number): Promise<Booking[]> {
    const rows: { id: string }[] = await manager.query(
      `SELECT b.id
         FROM bookings b
         JOIN seats s ON s.id = b.seat_id
         JOIN booking_policies p ON p.place_id = s.place_id
        WHERE b.status = 'CHECKED_IN'
          AND upper(b.time_range) + make_interval(mins => p.overdue_alert_minutes) <= $1
        ORDER BY upper(b.time_range)
        LIMIT $2
        FOR UPDATE OF b SKIP LOCKED`,
      [now, limit],
    );
    return this.findByIds(rows.map((r) => r.id), manager);
  }
}

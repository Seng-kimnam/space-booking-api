import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager, In, SelectQueryBuilder } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import { BookingStatus } from '../../common/enums';
import {
  isPgError,
  PG_EXCLUSION_VIOLATION,
} from '../../common/utils/db-errors';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import {
  ACTIVE_STATUSES,
  FINISHED_STATUSES,
  SEAT_HOLDING_STATUSES,
} from '../domain/booking-state';
import { BookingEvent } from '../entities/booking-event.entity';
import { Booking } from '../entities/booking.entity';

export type BookingListView = 'all' | 'upcoming' | 'history';

export interface AdminBookingFilters {
  status?: BookingStatus;
  userId?: string;
  seatId?: string;
  placeId?: string;
  /** Bookings overlapping [from, to). */
  from?: Date;
  to?: Date;
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** The exclusion constraint is the only double-booking check (AGENTS.md section 6.1). */
function mapConflict(err: unknown): unknown {
  return isPgError(err, PG_EXCLUSION_VIOLATION)
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
  async lockUser(manager: EntityManager, userId: string): Promise<void> {
    await manager.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
  }

  countActiveForUser(manager: EntityManager, userId: string): Promise<number> {
    return manager.getRepository(Booking).count({
      where: { userId, status: In([...ACTIVE_STATUSES]) },
    });
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
    page: number,
    limit: number,
  ): Promise<Page<Booking>> {
    const qb = this.query().where('b.userId = :userId', { userId });
    if (view === 'upcoming') {
      qb.andWhere('b.status IN (:...holding)', { holding: SEAT_HOLDING_STATUSES })
        .orderBy('lower(b.time_range)', 'ASC');
    } else if (view === 'history') {
      qb.andWhere('b.status IN (:...finished)', { finished: FINISHED_STATUSES })
        .orderBy('lower(b.time_range)', 'DESC');
    } else {
      qb.orderBy('b.createdAt', 'DESC');
    }
    const [items, total] = await qb
      // offset/limit, not skip/take: the joins are many-to-one so rows never
      // multiply, and skip/take's DISTINCT subquery breaks ORDER BY lower(...).
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();
    return { items, total };
  }

  async listAdmin(
    filters: AdminBookingFilters,
    page: number,
    limit: number,
  ): Promise<Page<Booking>> {
    const qb = this.query();
    if (filters.status) qb.andWhere('b.status = :status', { status: filters.status });
    if (filters.userId) qb.andWhere('b.userId = :userId', { userId: filters.userId });
    if (filters.seatId) qb.andWhere('b.seatId = :seatId', { seatId: filters.seatId });
    if (filters.placeId) qb.andWhere('s.placeId = :placeId', { placeId: filters.placeId });
    if (filters.from || filters.to) {
      // Unbounded side = -infinity / infinity.
      qb.andWhere(`b.time_range && tstzrange(:from, :to, '[)')`, {
        from: filters.from?.toISOString() ?? null,
        to: filters.to?.toISOString() ?? null,
      });
    }
    const [items, total] = await qb
      .orderBy('lower(b.time_range)', 'DESC')
      // offset/limit, not skip/take: the joins are many-to-one so rows never
      // multiply, and skip/take's DISTINCT subquery breaks ORDER BY lower(...).
      .offset((page - 1) * limit)
      .limit(limit)
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

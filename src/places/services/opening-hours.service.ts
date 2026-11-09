import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import { OpeningHourDto, PlaceClosureDto } from '../dto/opening-hour.dto';
import { PlaceClosure } from '../entities/place-closure.entity';
import { PlaceOpeningHour } from '../entities/place-opening-hour.entity';

/** Weekly opening hours and closure dates, always evaluated in places.timezone. */
@Injectable()
export class OpeningHoursService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * True if the place is open for the whole range: the range fits inside one
   * opening window (opened on the local start date, or the day before for
   * overnight hours) whose opening date is not a closure date. Pass the
   * caller's `manager` so the read joins its transaction.
   */
  async isOpenForRange(
    placeId: string,
    range: TimeRange,
    manager?: EntityManager,
  ): Promise<boolean> {
    const rows: { open: boolean }[] = await (manager ?? this.ds.manager).query(
      `SELECT EXISTS (
         SELECT 1
           FROM places p
           CROSS JOIN LATERAL (SELECT ($2::timestamptz AT TIME ZONE p.timezone) AS ls,
                                      ($3::timestamptz AT TIME ZONE p.timezone) AS le) r
           CROSS JOIN LATERAL (VALUES (r.ls::date), (r.ls::date - 1)) d(day)
           JOIN place_opening_hours h
             ON h.place_id = p.id AND h.weekday = EXTRACT(DOW FROM d.day)
          WHERE p.id = $1
            AND r.ls >= d.day + h.open_time
            AND r.le <= d.day + h.close_time
                        + CASE WHEN h.closes_next_day THEN interval '1 day' ELSE interval '0' END
            AND NOT EXISTS (SELECT 1 FROM place_closures c
                             WHERE c.place_id = p.id AND c.date = d.day)
       ) AS open`,
      [placeId, range.start.toISOString(), range.end.toISOString()],
    );
    return rows[0]?.open === true;
  }

  findHours(
    placeId: string,
    manager?: EntityManager,
  ): Promise<PlaceOpeningHour[]> {
    return (manager ?? this.ds.manager)
      .getRepository(PlaceOpeningHour)
      .find({ where: { placeId }, order: { weekday: 'ASC' } });
  }

  /** Closures dated today or later, "today" being the place-local date. */
  findUpcomingClosures(
    placeId: string,
    manager?: EntityManager,
  ): Promise<PlaceClosure[]> {
    return (manager ?? this.ds.manager)
      .getRepository(PlaceClosure)
      .createQueryBuilder('c')
      .innerJoin('c.place', 'p')
      .where('c.placeId = :placeId', { placeId })
      .andWhere('c.date >= (now() AT TIME ZONE p.timezone)::date')
      .orderBy('c.date', 'ASC')
      .getMany();
  }

  /** Replaces the weekly schedule. Run on the caller's transaction. */
  async replaceHours(
    manager: EntityManager,
    placeId: string,
    hours: OpeningHourDto[],
  ): Promise<void> {
    assertValidHours(hours);
    const repo = manager.getRepository(PlaceOpeningHour);
    await repo.delete({ placeId });
    if (hours.length === 0) return;
    await repo.insert(
      hours.map((h) => ({
        placeId,
        weekday: h.weekday,
        openTime: h.openTime,
        closeTime: h.closeTime,
        closesNextDay: h.closesNextDay ?? false,
      })),
    );
  }

  /** Replaces the closure list. Run on the caller's transaction. */
  async replaceClosures(
    manager: EntityManager,
    placeId: string,
    closures: PlaceClosureDto[],
  ): Promise<void> {
    assertValidClosures(closures);
    const repo = manager.getRepository(PlaceClosure);
    await repo.delete({ placeId });
    if (closures.length === 0) return;
    await repo.insert(
      closures.map((c) => ({
        placeId,
        date: c.date,
        reason: c.reason ?? null,
      })),
    );
  }
}

/**
 * Rules the DTO can't express per item: one entry per weekday, and a window
 * of at most 24 h (same day: open < close; overnight: close <= open).
 */
export function assertValidHours(hours: OpeningHourDto[]): void {
  const seen = new Set<number>();
  for (const h of hours) {
    if (seen.has(h.weekday))
      throw new BadRequestException(
        `openingHours has weekday ${h.weekday} more than once`,
      );
    seen.add(h.weekday);
    // HH:mm strings compare correctly as text.
    if (h.closesNextDay ? h.closeTime > h.openTime : h.closeTime <= h.openTime)
      throw new BadRequestException(
        h.closesNextDay
          ? `weekday ${h.weekday}: with closesNextDay, closeTime must be <= openTime`
          : `weekday ${h.weekday}: closeTime must be after openTime (use closesNextDay for overnight)`,
      );
  }
}

export function assertValidClosures(closures: PlaceClosureDto[]): void {
  const seen = new Set<string>();
  for (const c of closures) {
    if (seen.has(c.date))
      throw new BadRequestException(
        `closures has date ${c.date} more than once`,
      );
    seen.add(c.date);
  }
}

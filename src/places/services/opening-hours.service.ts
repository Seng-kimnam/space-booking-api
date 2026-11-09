import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlaceOpeningHour } from '../entities/place-opening-hour.entity';

// Raw SQL on purpose (AGENTS.md section 7: tstzrange logic). Postgres does the
// timezone maths: for every local day the range touches (plus the day before,
// for overnight windows), build that day's opening window in the place's
// timezone, skip closure dates, merge touching windows with range_agg (so
// Mon 18:00-24:00 + Tue 00:00-02:00 count as one window), then test containment.
// A closure removes the window that STARTS on that local date.
const IS_OPEN_SQL = `
SELECT COALESCE(
  range_agg(tstzrange(
    (d.day + h.open_time) AT TIME ZONE p.timezone,
    (d.day + h.close_time
       + CASE WHEN h.closes_next_day THEN interval '1 day' ELSE interval '0' END)
      AT TIME ZONE p.timezone,
    '[)'
  )) @> tstzrange($2::timestamptz, $3::timestamptz, '[)'),
  false
) AS open
FROM places p
CROSS JOIN LATERAL generate_series(
  (($2::timestamptz AT TIME ZONE p.timezone)::date - 1)::timestamp,
  (($3::timestamptz AT TIME ZONE p.timezone)::date)::timestamp,
  interval '1 day'
) AS d(day)
JOIN place_opening_hours h
  ON h.place_id = p.id AND h.weekday = EXTRACT(DOW FROM d.day)
WHERE p.id = $1
  AND p.deleted_at IS NULL
  AND p.is_active
  AND NOT EXISTS (
    SELECT 1 FROM place_closures c
    WHERE c.place_id = p.id AND c.date = d.day::date
  )`;

@Injectable()
export class OpeningHoursService {
  constructor(
    @InjectRepository(PlaceOpeningHour)
    private readonly hours: Repository<PlaceOpeningHour>,
  ) {}

  /**
   * True when the place is active, not deleted, and open for the whole
   * half-open range [start, end), evaluated in the place's timezone.
   * Used by bookings to reject reservations outside opening hours (AGENTS.md 6.6).
   */
  async isOpenForRange(
    placeId: string,
    start: Date,
    end: Date,
  ): Promise<boolean> {
    if (!(start.getTime() < end.getTime())) return false;
    const [row] = (await this.hours.query(IS_OPEN_SQL, [
      placeId,
      start.toISOString(),
      end.toISOString(),
    ])) as { open: boolean }[];
    return row?.open === true;
  }
}

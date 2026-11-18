import { ValueTransformer } from 'typeorm';

/** A bounded, half-open `[start, end)` range, as stored in a Postgres `tstzrange`. */
export interface TimeRange {
  start: Date;
  end: Date;
}

// Postgres prints ranges like ["2026-01-01 10:00:00+00","2026-01-01 12:00:00+00")
// Bounds may or may not be quoted, and either side may be empty (infinite).
const RANGE_PATTERN = /^[[(]"?([^",]*)"?,"?([^",]*)"?[\])]$/;

/**
 * Maps `tstzrange` <-> `TimeRange`.
 *
 * Only handles plain values. Overlap (`&&`) and bound (`lower()` / `upper()`)
 * queries are written with the query builder in the bookings repository
 * (AGENTS.md section 7), not through find options.
 */
export const tstzrangeTransformer: ValueTransformer = {
  to(value: TimeRange | null | undefined): string | null | undefined {
    if (value === null || value === undefined) return value;
    // Always '[)': the bookings_range_valid CHECK rejects any other bounds.
    return `[${value.start.toISOString()},${value.end.toISOString()})`;
  },

  from(value: string | null): TimeRange | null {
    if (value === null || value === undefined) return null;
    const match = RANGE_PATTERN.exec(value);
    if (!match || !match[1] || !match[2]) {
      // 'empty' or unbounded ranges are rejected by the CHECK constraint, so
      // reaching this means the column holds something we never wrote.
      throw new Error('Unexpected tstzrange value');
    }
    return { start: new Date(match[1]), end: new Date(match[2]) };
  },
};

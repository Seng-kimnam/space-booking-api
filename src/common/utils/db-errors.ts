import { QueryFailedError } from 'typeorm';

/** Postgres SQLSTATE codes we react to. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_EXCLUSION_VIOLATION = '23P01';
// Concurrent transactions that conflict on the same exclusion index can make
// Postgres pick one as a deadlock victim instead of raising 23P01.
export const PG_DEADLOCK_DETECTED = '40P01';
export const PG_SERIALIZATION_FAILURE = '40001';

interface PgDriverError {
  code?: string;
  constraint?: string;
}

/** True when `err` is a Postgres error with this SQLSTATE (and constraint, if given). */
export function isPgError(
  err: unknown,
  code: string,
  constraint?: string,
): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driver = err.driverError as PgDriverError;
  return (
    driver?.code === code &&
    (constraint === undefined || driver.constraint === constraint)
  );
}

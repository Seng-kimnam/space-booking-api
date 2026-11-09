import { registerDecorator, ValidationOptions } from 'class-validator';

// Canonical IANA names only. Offsets like "+07:00" are rejected on purpose:
// Postgres `AT TIME ZONE '+07:00'` reads POSIX offsets with the sign inverted.
const TIMEZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

export function IsIanaTimezone(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isIanaTimezone',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be an IANA time zone, e.g. Asia/Phnom_Penh`,
        ...options,
      },
      validator: {
        validate: (v: unknown) => typeof v === 'string' && TIMEZONES.has(v),
      },
    });
}

/** 'HH:mm', 00:00..23:59. */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'YYYY-MM-DD' shape; calendar validity is checked with IsISO8601 strict. */
export const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/** Trim strings, leave other values for the type validators to reject. */
export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** For PATCH DTOs: only `undefined` means "unchanged", so null reaches validation. */
export const present = (_: unknown, v: unknown) => v !== undefined;

/** For nullable PATCH fields: undefined = unchanged, null = clear. */
export const presentNotNull = (_: unknown, v: unknown) =>
  v !== undefined && v !== null;

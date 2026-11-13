import type { PlaceSnapshotV1, PlaceSyncRejectedV1 } from '../../../messaging/contract/types';

/** Reserved prefix for temporary labels and names while a snapshot is applied. */
export const TEMP_PREFIX = '~sync~';

/** 'HH:mm' -> 'HH:mm:00' (the time column format we compare against). */
export const toDbTime = (t: string): string => (t.length === 5 ? `${t}:00` : t);

export type SnapshotRejection = Pick<PlaceSyncRejectedV1, 'code' | 'message' | 'details'>;

const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const isCalendarDate = (value: string): boolean => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const reject = (
  code: SnapshotRejection['code'],
  message: string,
  path: string,
  value: string | number | boolean | null,
): SnapshotRejection => ({ code, message, details: [{ path, value }] });

/** First duplicate of `key` in `items`, as [index, value]. */
function firstDuplicate<T>(items: T[], key: (item: T) => string): [number, string] | null {
  const seen = new Set<string>();
  for (const [i, item] of items.entries()) {
    const k = key(item);
    if (seen.has(k)) return [i, k];
    seen.add(k);
  }
  return null;
}

/**
 * Rules the JSON schema can't express, matching what our admin API accepts.
 * Returns null when the snapshot can be applied.
 */
export function checkSnapshot(s: PlaceSnapshotV1): SnapshotRejection | null {
  if (!isValidTimeZone(s.timezone))
    return reject('INVALID_TIMEZONE', `Unknown time zone ${s.timezone}`, 'timezone', s.timezone);

  const day = firstDuplicate(s.openingHours, (h) => String(h.weekday));
  if (day)
    return reject('INVALID_OPENING_HOURS', `Weekday ${day[1]} is listed twice`, `openingHours[${day[0]}].weekday`, Number(day[1]));
  for (const [i, h] of s.openingHours.entries()) {
    // Same day: open < close. Overnight: close <= open (never more than 24 h).
    const ok = h.closesNextDay ? h.close <= h.open : h.open < h.close;
    if (!ok)
      return reject(
        'INVALID_OPENING_HOURS',
        h.closesNextDay ? 'Overnight close must be at or before open' : 'close must be after open',
        `openingHours[${i}].close`,
        h.close,
      );
  }

  for (const [i, c] of s.closures.entries())
    if (!isCalendarDate(c.date))
      return reject('INVALID_CLOSURES', `Invalid date ${c.date}`, `closures[${i}].date`, c.date);
  const date = firstDuplicate(s.closures, (c) => c.date);
  if (date) return reject('INVALID_CLOSURES', `Date ${date[1]} is listed twice`, `closures[${date[0]}].date`, date[1]);

  const areaId = firstDuplicate(s.areas, (a) => a.areaId);
  if (areaId) return reject('DUPLICATE_ID', `Area id ${areaId[1]} is listed twice`, `areas[${areaId[0]}].areaId`, areaId[1]);
  const areaName = firstDuplicate(s.areas, (a) => a.name);
  if (areaName)
    return reject('AREA_NAME_CONFLICT', `Area name ${areaName[1]} is used twice`, `areas[${areaName[0]}].name`, areaName[1]);

  const seatId = firstDuplicate(s.seats, (x) => x.seatId);
  if (seatId) return reject('DUPLICATE_ID', `Seat id ${seatId[1]} is listed twice`, `seats[${seatId[0]}].seatId`, seatId[1]);
  const label = firstDuplicate(s.seats, (x) => x.label);
  if (label)
    return reject('SEAT_LABEL_CONFLICT', `Seat label ${label[1]} is used twice`, `seats[${label[0]}].label`, label[1]);
  const tempSeat = s.seats.findIndex((x) => x.label.startsWith(TEMP_PREFIX));
  if (tempSeat >= 0)
    return reject('SEAT_LABEL_CONFLICT', `Labels may not start with ${TEMP_PREFIX}`, `seats[${tempSeat}].label`, s.seats[tempSeat].label);
  const tempArea = s.areas.findIndex((a) => a.name.startsWith(TEMP_PREFIX));
  if (tempArea >= 0)
    return reject('AREA_NAME_CONFLICT', `Area names may not start with ${TEMP_PREFIX}`, `areas[${tempArea}].name`, s.areas[tempArea].name);

  const areaIds = new Set(s.areas.map((a) => a.areaId));
  const orphan = s.seats.findIndex((x) => x.areaId !== null && !areaIds.has(x.areaId));
  if (orphan >= 0)
    return reject('UNKNOWN_AREA', `Seat ${s.seats[orphan].seatId} points to an area not in the snapshot`, `seats[${orphan}].areaId`, s.seats[orphan].areaId);

  return null;
}

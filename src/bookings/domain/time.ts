export const MINUTE_MS = 60_000;

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MINUTE_MS;
}

/**
 * Wall-clock time in an IANA zone, "YYYY-MM-DD HH:mm" (output only: times are
 * stored and compared in UTC, AGENTS.md section 6.6).
 */
export function formatInZone(date: Date, timezone: string): string {
  // The sv-SE locale formats as "2026-11-08 10:00".
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * UTC offset of an IANA zone at an instant, in minutes (Asia/Kolkata -> 330,
 * America/St_Johns in winter -> -210). Unknown or empty zone -> 0 (UTC).
 */
export function zoneOffsetMinutes(date: Date, timezone: string): number {
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      timeZoneName: 'longOffset',
    })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value;
  } catch {
    return 0;
  }
  // "GMT+05:30", "GMT-03:30", or plain "GMT" for UTC.
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

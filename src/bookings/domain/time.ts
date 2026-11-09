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

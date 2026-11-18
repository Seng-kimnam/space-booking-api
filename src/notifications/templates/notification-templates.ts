import { NotificationType } from '../../common/enums';
import type { RenderedNotification } from '../channels/notification-channel.strategy';

/**
 * `notifications.payload` for booking alerts. Template data only: never codes,
 * tokens or QR payloads (docs/erd.md, notifications).
 */
export interface BookingAlertPayload {
  [key: string]: unknown;
  groupId: string;
  placeName: string;
  /** IANA zone of the place; times are shown in it. */
  timezone: string;
  seatLabels: string[];
  startAt: string;
  endAt: string;
  /** LATE_CHECKIN / BOOKING_EXPIRED: start + checkin_grace_minutes. */
  checkinDeadline?: string;
  /** BOOKING_MODIFIED / BOOKING_EXTENDED: the range before the change. */
  previousStartAt?: string;
  previousEndAt?: string;
}

const BOOKING_TYPES = new Set<NotificationType>([
  NotificationType.BOOKING_CONFIRMED,
  NotificationType.BOOKING_CANCELLED,
  NotificationType.LATE_CHECKIN,
  NotificationType.CHECKOUT_REMINDER,
  NotificationType.BOOKING_EXPIRED,
  NotificationType.FORGOTTEN_CHECKOUT,
  NotificationType.BOOKING_MODIFIED,
  NotificationType.BOOKING_EXTENDED,
  NotificationType.CHECKED_IN,
  NotificationType.CHECKED_OUT,
]);

function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

function seatsText(labels: string[]): string {
  return labels.length === 1
    ? `seat ${labels[0]}`
    : `seats ${labels.join(', ')}`;
}

/** Returns null for types this module has no template for (auth emails). */
export function renderNotification(
  type: NotificationType,
  payload: BookingAlertPayload,
): RenderedNotification | null {
  if (!BOOKING_TYPES.has(type)) return null;

  const tz = payload.timezone;
  const seats = seatsText(payload.seatLabels);
  const where = `${seats} at ${payload.placeName}`;
  const start = formatTime(payload.startAt, tz);
  const end = formatTime(payload.endAt, tz);
  const when = `${formatDate(payload.startAt, tz)}, ${start} - ${end}`;
  const deadline = payload.checkinDeadline
    ? formatTime(payload.checkinDeadline, tz)
    : null;
  const before =
    payload.previousStartAt && payload.previousEndAt
      ? `${formatDate(payload.previousStartAt, tz)}, ${formatTime(payload.previousStartAt, tz)} - ${formatTime(payload.previousEndAt, tz)}`
      : null;

  switch (type) {
    case NotificationType.BOOKING_CONFIRMED:
      return {
        title: 'Booking confirmed',
        body: `You booked ${where}.\n${when}\nShow your QR code at the place to check in.`,
      };
    case NotificationType.LATE_CHECKIN:
      return {
        title: "You haven't checked in yet",
        body:
          `Your booking for ${where} started at ${start}.` +
          (deadline
            ? ` Check in before ${deadline}, or the booking will be cancelled and the seat released.`
            : ' Check in soon, or the booking will be cancelled.'),
      };
    case NotificationType.BOOKING_EXPIRED:
      return {
        title: 'Booking cancelled: no check-in',
        body: `You didn't check in to ${where} (${when}) in time, so the booking was cancelled and the seat released.`,
      };
    case NotificationType.CHECKOUT_REMINDER:
      return {
        title: 'Your booking ends soon',
        body: `Your booking for ${where} ends at ${end}. Extend it in the app, or check out with your QR code when you leave.`,
      };
    case NotificationType.FORGOTTEN_CHECKOUT:
      return {
        title: 'Did you forget to check out?',
        body: `Your booking for ${where} ended at ${end}, but you haven't checked out. Please check out with your QR code, or ask the staff.`,
      };
    case NotificationType.BOOKING_CANCELLED:
      return {
        title: 'Booking cancelled',
        body: `Your booking for ${where} (${when}) was cancelled.`,
      };
    case NotificationType.BOOKING_MODIFIED:
      return {
        title: 'Booking changed',
        body:
          `Your booking for ${where} was changed.\n` +
          (before ? `Was: ${before}\nNow: ${when}` : `New time: ${when}`) +
          '\nYour old QR code no longer works: open the booking in the app for a new one.',
      };
    case NotificationType.BOOKING_EXTENDED:
      return {
        title: 'Booking extended',
        body:
          `Your booking for ${where} now ends at ${end}` +
          (payload.previousEndAt
            ? ` (was ${formatTime(payload.previousEndAt, tz)}).`
            : '.'),
      };
    case NotificationType.CHECKED_IN:
      return {
        title: 'Checked in',
        body: `You're checked in to ${where}. Your booking ends at ${end}; check out with your QR code when you leave.`,
      };
    case NotificationType.CHECKED_OUT:
      return {
        title: 'Checked out',
        body: `You've checked out of ${where}. Thanks for visiting!`,
      };
    default:
      return null;
  }
}

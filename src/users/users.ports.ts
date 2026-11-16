import type { EntityManager } from 'typeorm';

/**
 * Data users needs from modules that import it (so it can't import them):
 *   USER_BOOKINGS      -> UserBookingsService      (BookingsBindingsModule)
 *   USER_NOTIFICATIONS -> UserNotificationsService (UsersBindingsModule)
 *   LINKED_ACCOUNTS    -> LinkedAccountsService    (UsersBindingsModule)
 * Injected @Optional() so partial test modules still compile.
 */

export interface UserBookingSummary {
  /** Counted per seat. */
  total: number;
  upcoming: number;
  active: number;
  completed: number;
  cancelled: number;
  expired: number;
  /** COMPLETED bookings only. */
  hoursBooked: number;
  favouritePlace: { id: string; name: string; bookings: number } | null;
}

/** Who caused the event, relative to the user viewed. */
export type ActivityActor = 'SELF' | 'OTHER_USER' | 'API_CLIENT' | 'SYSTEM';

export interface UserActivityItem {
  id: string;
  bookingId: string;
  type: string;
  actor: ActivityActor;
  /** false = the user acted on someone else's booking. */
  ownBooking: boolean;
  placeName: string;
  seatLabel: string;
  createdAt: Date;
}

export const USER_BOOKINGS = Symbol('USER_BOOKINGS');
export interface UserBookingsPort {
  /** Checked in or overdue; blocks account closure. */
  hasSeatInUse(manager: EntityManager, userId: string): Promise<boolean>;
  /** Cancels all PENDING bookings on `manager` (normal alerts/events); returns the count. */
  cancelAllPending(
    manager: EntityManager,
    userId: string,
    actorId: string,
    now: Date,
  ): Promise<number>;
  summary(userId: string): Promise<UserBookingSummary>;
  activity(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ items: UserActivityItem[]; total: number }>;
}

export interface UserNotificationItem {
  id: string;
  type: string;
  channel: string;
  status: string;
  bookingId: string | null;
  scheduledAt: Date;
  sentAt: Date | null;
  attempts: number;
  /** Admin view only. */
  lastError?: string | null;
  createdAt: Date;
}

export const USER_NOTIFICATIONS = Symbol('USER_NOTIFICATIONS');
export interface UserNotificationsPort {
  list(
    userId: string,
    page: number,
    limit: number,
    withErrors: boolean,
  ): Promise<{ items: UserNotificationItem[]; total: number }>;
}

export interface LinkedAccounts {
  telegram: { linked: boolean; username: string | null; linkedAt: Date | null };
  /** LMS memberships. */
  external: { system: string; memberId: string; linkedAt: Date; eligible: boolean | null }[];
}

export const LINKED_ACCOUNTS = Symbol('LINKED_ACCOUNTS');
export interface LinkedAccountsPort {
  forUser(userId: string): Promise<LinkedAccounts>;
}

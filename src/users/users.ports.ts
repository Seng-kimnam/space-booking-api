import type { EntityManager } from 'typeorm';

/**
 * Data the users module shows or changes but doesn't own. Bookings, telegram
 * and notifications import UsersModule, so users can't import them back
 * (docs/project-structure.md section 3). The tokens are bound with useExisting
 * by the owning side:
 *   USER_BOOKINGS      -> UserBookingsService     (BookingsBindingsModule)
 *   USER_NOTIFICATIONS -> UserNotificationsService (UsersBindingsModule)
 *   LINKED_ACCOUNTS    -> LinkedAccountsService    (UsersBindingsModule)
 * Injected @Optional() so unit and partial e2e modules compile without them.
 */

export interface UserBookingSummary {
  /** Seat bookings (a multi-seat booking counts once per seat). */
  total: number;
  upcoming: number;
  active: number;
  completed: number;
  cancelled: number;
  expired: number;
  /** Hours of COMPLETED bookings. */
  hoursBooked: number;
  favouritePlace: { id: string; name: string; bookings: number } | null;
}

/** Who caused a booking event, seen from the user being looked at. */
export type ActivityActor = 'SELF' | 'OTHER_USER' | 'API_CLIENT' | 'SYSTEM';

export interface UserActivityItem {
  id: string;
  bookingId: string;
  type: string;
  actor: ActivityActor;
  /** false when the user acted on someone else's booking (admin check-in). */
  ownBooking: boolean;
  placeName: string;
  seatLabel: string;
  createdAt: Date;
}

export const USER_BOOKINGS = Symbol('USER_BOOKINGS');
export interface UserBookingsPort {
  /** CHECKED_IN or CHECKOUT_OVERDUE booking exists (can't close the account). */
  hasSeatInUse(manager: EntityManager, userId: string): Promise<boolean>;
  /**
   * Cancels every PENDING booking of the user on `manager`, with the normal
   * cancellation alert, event and outbox row. `actorId` is the user (self
   * delete) or the admin. Returns how many were cancelled.
   */
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
  /** Admin view only: the delivery error. */
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
  /** Partner (LMS) memberships linked to the account. */
  external: { system: string; memberId: string; linkedAt: Date; eligible: boolean | null }[];
}

export const LINKED_ACCOUNTS = Symbol('LINKED_ACCOUNTS');
export interface LinkedAccountsPort {
  forUser(userId: string): Promise<LinkedAccounts>;
}

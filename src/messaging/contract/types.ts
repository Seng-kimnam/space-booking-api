/**
 * TypeScript shapes of the contract messages (mirror of schemas.ts). Incoming
 * data is only typed this way after the schema validator accepted it.
 */

export interface PlaceSnapshotV1 {
  placeId: string;
  code: string | null;
  revision: number;
  name: string;
  description: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
  bookingEnabled: boolean;
  openingHours: { weekday: number; open: string; close: string; closesNextDay: boolean }[];
  closures: { date: string; reason: string | null }[];
  areas: {
    areaId: string;
    name: string;
    floor: string | null;
    type: string | null;
    description: string | null;
    status: 'ACTIVE' | 'INACTIVE';
  }[];
  seats: {
    seatId: string;
    areaId: string | null;
    label: string;
    features: Record<string, string | number | boolean>;
    status: 'ACTIVE' | 'MAINTENANCE' | 'UNAVAILABLE';
  }[];
}

export interface PlaceSyncAppliedV1 {
  placeId: string;
  revision: number;
  sbPlaceId: string;
  bookingOpen: boolean;
  seats: { seatId: string; sbSeatId: string }[];
  cancelledBookings: number;
}

export type SyncRejectionCode =
  | 'INVALID_TIMEZONE'
  | 'INVALID_OPENING_HOURS'
  | 'INVALID_CLOSURES'
  | 'SEAT_LABEL_CONFLICT'
  | 'AREA_NAME_CONFLICT'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_AREA'
  | 'LIMIT_EXCEEDED'
  | 'OTHER';

export interface PlaceSyncRejectedV1 {
  placeId: string;
  revision: number;
  code: SyncRejectionCode;
  message: string;
  details: { path: string; value: string | number | boolean | null }[];
}

export interface BookingExternalV1 {
  system: 'library';
  placeId: string;
  seatId: string | null;
  memberId: string | null;
}

export interface BookingEventV1 {
  bookingId: string;
  groupId: string | null;
  userId: string;
  seatId: string;
  placeId: string | null;
  source: 'APP' | 'API_CLIENT' | 'ADMIN';
  status: 'PENDING' | 'CHECKED_IN' | 'CHECKOUT_OVERDUE' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  startAt: string;
  endAt: string;
  previousStartAt: string | null;
  previousEndAt: string | null;
  actor: { userId: string } | { system: true };
  cancelReason: 'USER_CANCELLED' | 'ADMIN_CANCELLED' | 'LIBRARY_PLACE_CHANGED' | null;
  occurredAt: string;
  external: BookingExternalV1 | null;
}

export interface BookingAlertDueV1 {
  bookingId: string;
  groupId: string | null;
  seatId: string;
  placeId: string;
  alertType: 'LATE_CHECKIN' | 'CHECKOUT_REMINDER' | 'FORGOTTEN_CHECKOUT';
  startAt: string;
  endAt: string;
  dueAt: string;
  occurredAt: string;
  external: BookingExternalV1 | null;
}

export interface IdentityV1 {
  system: 'library';
  memberId: string;
  linked: boolean;
  changedAt: string;
}

export type StandingReason =
  | 'ACCOUNT_DISABLED'
  | 'MEMBERSHIP_PENDING_DEPOSIT'
  | 'MEMBERSHIP_EXPIRED'
  | 'OVERDUE_ITEMS'
  | 'BLOCKED_UNTIL';

export interface MemberStandingChangedV1 {
  memberId: string;
  eligible: boolean;
  reasons: StandingReason[];
  accountStatus: 'ACTIVE' | 'DISABLED';
  membershipStatus: 'PENDING_DEPOSIT' | 'ACTIVE' | 'EXPIRED';
  expiryDate: string | null;
  blockedUntil: string | null;
  evaluatedAt: string;
}

/** `data` of each message we publish, by routing key. */
export interface PublishedPayloads {
  'booking.created': BookingEventV1;
  'booking.modified': BookingEventV1;
  'booking.extended': BookingEventV1;
  'booking.cancelled': BookingEventV1;
  'booking.checked_in': BookingEventV1;
  'booking.checked_out': BookingEventV1;
  'booking.expired': BookingEventV1;
  'booking.checkout_overdue': BookingEventV1;
  'booking.alert_due': BookingAlertDueV1;
  'place.sync_applied': PlaceSyncAppliedV1;
  'place.sync_rejected': PlaceSyncRejectedV1;
  'identity.linked': IdentityV1;
  'identity.unlinked': IdentityV1;
}

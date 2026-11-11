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

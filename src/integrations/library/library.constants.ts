import { MessageType } from '../../messaging/contract/schemas';

/** places.external_system and envelope source / broker user of the LMS. */
export const LIBRARY_SYSTEM = 'library';
/** LMS exchange (declared by LMS). */
export const LIBRARY_EXCHANGE = 'library.events';
/** Our queue for LMS events and its key inside space-booking.dlx. */
export const LIBRARY_QUEUE = 'space-booking.library-events';
export const LIBRARY_DLX_KEY = 'library-events';

/** LMS routing keys, from the contract registry (src/messaging/contract/schemas.ts). */
export const LibraryRoutingKey = {
  PLACE_CREATED: MessageType.PLACE_CREATED,
  PLACE_UPDATED: MessageType.PLACE_UPDATED,
  MEMBER_STANDING_CHANGED: MessageType.MEMBER_STANDING_CHANGED,
  SYNC_APPLIED: MessageType.PLACE_SYNC_APPLIED,
  SYNC_REJECTED: MessageType.PLACE_SYNC_REJECTED,
  IDENTITY_LINKED: MessageType.IDENTITY_LINKED,
  IDENTITY_UNLINKED: MessageType.IDENTITY_UNLINKED,
} as const;

/** booking_events.metadata.subReason when a sync cancels a booking. */
export type PlaceChangeReason =
  | 'SEAT_REMOVED'
  | 'SEAT_NOT_ACTIVE'
  | 'PLACE_NOT_OPEN'
  | 'OUTSIDE_OPENING_HOURS';

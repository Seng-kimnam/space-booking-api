/** places.external_system and envelope source / broker user of the LMS. */
export const LIBRARY_SYSTEM = 'library';
/** LMS exchange (declared by LMS). */
export const LIBRARY_EXCHANGE = 'library.events';
/** Our queue for LMS events and its key inside space-booking.dlx. */
export const LIBRARY_QUEUE = 'space-booking.library-events';
export const LIBRARY_DLX_KEY = 'library-events';

export const LibraryRoutingKey = {
  PLACE_CREATED: 'place.created',
  PLACE_UPDATED: 'place.updated',
  SYNC_APPLIED: 'place.sync_applied',
  SYNC_REJECTED: 'place.sync_rejected',
} as const;

/** booking_events.metadata.subReason when a sync cancels a booking. */
export type PlaceChangeReason =
  | 'SEAT_REMOVED'
  | 'SEAT_NOT_ACTIVE'
  | 'PLACE_NOT_OPEN'
  | 'OUTSIDE_OPENING_HOURS';

/** LMS name in places.external_system, envelope source and broker user. */
export const LIBRARY_SYSTEM = 'library';

/** Exchange LMS publishes to (LMS declares it, not us). */
export const LIBRARY_EXCHANGE = 'library.events';
/** Our queue for LMS events, and its routing key inside space-booking.dlx. */
export const LIBRARY_QUEUE = 'space-booking.library-events';
export const LIBRARY_DLX_KEY = 'library-events';

/** LMS ids (places, members): same rule as the message contract. */
export const LMS_ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;

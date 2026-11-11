/**
 * JSON Schemas (2020-12) of every message exchanged with partners. This file is
 * the source of truth: the consumer runner validates incoming messages with it,
 * contract tests check what we publish against it, and
 * docs/integration/schemas/*.json are copies for partners
 * (schemas.spec.ts fails when they drift).
 *
 * Rules (docs/integration/messaging-contract.md section 3.2 and section 5):
 * - consumers ignore unknown fields, so no `additionalProperties: false`;
 * - optional fields are present with null;
 * - ids are strings, times are UTC ISO 8601 unless marked local, enums UPPER_SNAKE.
 */

const BASE = 'https://space-booking.local/schemas';

const uuid = { type: 'string', format: 'uuid' } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;
const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;
/** Partner ids (LMS bigints as strings). */
const externalId = { type: 'string', pattern: '^[0-9A-Za-z_-]{1,64}$' } as const;
const localDate = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', format: 'date' } as const;
const localTime = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } as const;

export const envelopeV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}/envelope.v1.json`,
  title: 'Message envelope v1 (every event, every producer)',
  description:
    'docs/integration/messaging-contract.md section 3.2. AMQP properties: message_id = id, type = type, app_id = user_id = source, header x-schema-version = version.',
  type: 'object',
  required: ['id', 'type', 'version', 'source', 'occurredAt', 'correlationId', 'subject', 'data'],
  properties: {
    id: { ...uuid, description: 'Same as AMQP message_id; the dedupe key' },
    type: {
      type: 'string',
      pattern: '^[a-z_]+\\.[a-z_]+$',
      description: 'Routing key without the .vN suffix',
    },
    version: { type: 'integer', minimum: 1 },
    source: { enum: ['space-booking', 'library'] },
    occurredAt: dateTime,
    correlationId: { type: ['string', 'null'], maxLength: 200 },
    subject: {
      type: 'object',
      required: ['type', 'id'],
      properties: {
        type: { type: 'string' },
        id: { type: 'string', minLength: 1, maxLength: 64 },
      },
    },
    data: { type: 'object' },
  },
} as const;

/** `external` on booking.* and booking.alert_due: the partner's ids, or null. */
const bookingExternal = {
  type: ['object', 'null'],
  description:
    'Partner ids when the place is partner-managed, otherwise null. memberId stays null until account linking (phase 2).',
  required: ['system', 'placeId', 'seatId', 'memberId'],
  properties: {
    system: { const: 'library' },
    placeId: externalId,
    seatId: { anyOf: [externalId, { type: 'null' }] },
    memberId: { anyOf: [externalId, { type: 'null' }] },
  },
} as const;

export const BOOKING_ROUTING_KEYS = [
  'booking.created',
  'booking.modified',
  'booking.extended',
  'booking.cancelled',
  'booking.checked_in',
  'booking.checked_out',
  'booking.expired',
  'booking.checkout_overdue',
] as const;

export const CANCEL_REASONS = ['USER_CANCELLED', 'ADMIN_CANCELLED', 'LIBRARY_PLACE_CHANGED'] as const;

export const bookingV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}/booking.v1.json`,
  title: 'booking.* data v1 (Space Booking -> partners)',
  description: `data of ${BOOKING_ROUTING_KEYS.join(', ')}. Ids are Space Booking ids; partner ids are in external. userId must not be stored by partners.`,
  type: 'object',
  required: [
    'bookingId', 'groupId', 'userId', 'seatId', 'placeId', 'source', 'status', 'startAt', 'endAt',
    'previousStartAt', 'previousEndAt', 'actor', 'cancelReason', 'occurredAt', 'external',
  ],
  properties: {
    bookingId: uuid,
    groupId: { anyOf: [uuid, { type: 'null' }], description: 'Shared by the seats of one multi-seat booking' },
    userId: uuid,
    seatId: uuid,
    placeId: { anyOf: [uuid, { type: 'null' }] },
    source: { enum: ['APP', 'API_CLIENT', 'ADMIN'] },
    status: {
      enum: ['PENDING', 'CHECKED_IN', 'CHECKOUT_OVERDUE', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
      description: 'Status after the change',
    },
    startAt: dateTime,
    endAt: dateTime,
    previousStartAt: { ...nullableDateTime, description: 'booking.modified / booking.extended only, else null' },
    previousEndAt: { ...nullableDateTime, description: 'booking.modified / booking.extended only, else null' },
    actor: {
      oneOf: [
        { type: 'object', required: ['userId'], properties: { userId: uuid } },
        { type: 'object', required: ['system'], properties: { system: { const: true } } },
      ],
    },
    cancelReason: {
      anyOf: [{ enum: [...CANCEL_REASONS] }, { type: 'null' }],
      description: 'booking.cancelled only, else null. Machine code; user free text is never sent.',
    },
    occurredAt: dateTime,
    external: bookingExternal,
  },
} as const;

export const bookingAlertDueV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}/booking.alert_due.v1.json`,
  title: 'booking.alert_due data v1 (Space Booking -> partners, phase 2: not published yet)',
  type: 'object',
  required: ['bookingId', 'groupId', 'seatId', 'placeId', 'alertType', 'startAt', 'endAt', 'dueAt', 'occurredAt', 'external'],
  properties: {
    bookingId: uuid,
    groupId: { anyOf: [uuid, { type: 'null' }] },
    seatId: uuid,
    placeId: uuid,
    alertType: { enum: ['LATE_CHECKIN', 'CHECKOUT_REMINDER', 'FORGOTTEN_CHECKOUT'] },
    startAt: dateTime,
    endAt: dateTime,
    dueAt: dateTime,
    occurredAt: dateTime,
    external: bookingExternal,
  },
} as const;

export const PLACE_LIMITS = {
  openingHours: 7,
  closures: 366,
  areas: 500,
  seats: 5000,
} as const;

export const placeSnapshotV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}/place.snapshot.v1.json`,
  title: 'place.created / place.updated data v1 (LMS -> Space Booking)',
  description:
    'The full place, every time. Applied only if revision is greater than the last applied one. Areas and seats not in the snapshot are removed on our side.',
  type: 'object',
  required: [
    'placeId', 'code', 'revision', 'name', 'description', 'address', 'lat', 'lng', 'timezone',
    'status', 'bookingEnabled', 'openingHours', 'closures', 'areas', 'seats',
  ],
  properties: {
    placeId: externalId,
    code: { type: ['string', 'null'], maxLength: 30 },
    revision: { type: 'integer', minimum: 1, description: '+1 per committed change, per place' },
    name: { type: 'string', minLength: 1, maxLength: 150 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    address: { type: 'string', minLength: 1, maxLength: 255 },
    lat: { type: ['number', 'null'], minimum: -90, maximum: 90 },
    lng: { type: ['number', 'null'], minimum: -180, maximum: 180 },
    timezone: { type: 'string', minLength: 1, maxLength: 64, description: 'IANA name' },
    status: { enum: ['ACTIVE', 'INACTIVE'] },
    bookingEnabled: { type: 'boolean' },
    openingHours: {
      type: 'array',
      maxItems: PLACE_LIMITS.openingHours,
      description: 'Local times. A missing weekday means closed.',
      items: {
        type: 'object',
        required: ['weekday', 'open', 'close', 'closesNextDay'],
        properties: {
          weekday: { type: 'integer', minimum: 0, maximum: 6, description: '0 = Sunday' },
          open: localTime,
          close: localTime,
          closesNextDay: { type: 'boolean' },
        },
      },
    },
    closures: {
      type: 'array',
      maxItems: PLACE_LIMITS.closures,
      description: 'Local dates, from place-local today onward',
      items: {
        type: 'object',
        required: ['date', 'reason'],
        properties: { date: localDate, reason: { type: ['string', 'null'], maxLength: 255 } },
      },
    },
    areas: {
      type: 'array',
      maxItems: PLACE_LIMITS.areas,
      description: 'Bookable areas only',
      items: {
        type: 'object',
        required: ['areaId', 'name', 'floor', 'type', 'description', 'status'],
        properties: {
          areaId: externalId,
          name: { type: 'string', minLength: 1, maxLength: 100 },
          floor: { type: ['string', 'null'], maxLength: 30 },
          type: {
            type: ['string', 'null'],
            description: 'READING_ROOM, QUIET_ZONE, GROUP_STUDY, COMPUTER_LAB, OTHER. Ignored by Space Booking in v1.',
          },
          description: { type: ['string', 'null'], maxLength: 2000 },
          status: { enum: ['ACTIVE', 'INACTIVE'] },
        },
      },
    },
    seats: {
      type: 'array',
      maxItems: PLACE_LIMITS.seats,
      description: 'Bookable, non-retired seats only',
      items: {
        type: 'object',
        required: ['seatId', 'areaId', 'label', 'features', 'status'],
        properties: {
          seatId: externalId,
          areaId: { anyOf: [externalId, { type: 'null' }] },
          label: { type: 'string', minLength: 1, maxLength: 30 },
          features: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
            maxProperties: 30,
          },
          status: { enum: ['ACTIVE', 'MAINTENANCE', 'UNAVAILABLE'] },
        },
      },
    },
  },
} as const;

export const placeSyncAppliedV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}/place.sync_applied.v1.json`,
  title: 'place.sync_applied data v1 (Space Booking -> LMS)',
  description:
    'A snapshot revision was applied, or our admin switched the place on or off (same revision). subject.id is the LMS placeId.',
  type: 'object',
  required: ['placeId', 'revision', 'sbPlaceId', 'bookingOpen', 'seats', 'cancelledBookings'],
  properties: {
    placeId: externalId,
    revision: { type: 'integer', minimum: 1 },
    sbPlaceId: uuid,
    bookingOpen: { type: 'boolean', description: 'Space Booking is_active AND LMS status/bookingEnabled' },
    seats: {
      type: 'array',
      items: {
        type: 'object',
        required: ['seatId', 'sbSeatId'],
        properties: { seatId: externalId, sbSeatId: uuid },
      },
    },
    cancelledBookings: { type: 'integer', minimum: 0, description: 'Bookings cancelled by this revision (count only)' },
  },
} as const;

export const SYNC_REJECTION_CODES = [
  'INVALID_TIMEZONE',
  'INVALID_OPENING_HOURS',
  'INVALID_CLOSURES',
  'SEAT_LABEL_CONFLICT',
  'AREA_NAME_CONFLICT',
  'DUPLICATE_ID',
  'UNKNOWN_AREA',
  'LIMIT_EXCEEDED',
  'OTHER',
] as const;

export const placeSyncRejectedV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}/place.sync_rejected.v1.json`,
  title: 'place.sync_rejected data v1 (Space Booking -> LMS)',
  description:
    'A valid message whose data we can not apply. Our state stays at the last applied revision. LMS fixes the data and sends a new revision. subject.id is the LMS placeId.',
  type: 'object',
  required: ['placeId', 'revision', 'code', 'message', 'details'],
  properties: {
    placeId: externalId,
    revision: { type: 'integer', minimum: 1 },
    code: { enum: [...SYNC_REJECTION_CODES] },
    message: { type: 'string', maxLength: 500 },
    details: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        required: ['path', 'value'],
        properties: {
          path: { type: 'string', description: 'e.g. seats[4].label' },
          value: { type: ['string', 'number', 'boolean', 'null'] },
        },
      },
    },
  },
} as const;

export const identityV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}/identity.v1.json`,
  title: 'identity.linked / identity.unlinked data v1 (Space Booking -> LMS, phase 2: not published yet)',
  description: 'No Space Booking user id, email or name is ever sent.',
  type: 'object',
  required: ['system', 'memberId', 'linked', 'changedAt'],
  properties: {
    system: { const: 'library' },
    memberId: externalId,
    linked: { type: 'boolean' },
    changedAt: dateTime,
  },
} as const;

export const STANDING_REASONS = [
  'ACCOUNT_DISABLED',
  'MEMBERSHIP_PENDING_DEPOSIT',
  'MEMBERSHIP_EXPIRED',
  'OVERDUE_ITEMS',
  'BLOCKED_UNTIL',
] as const;

export const memberStandingChangedV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}/member.standing_changed.v1.json`,
  title: 'member.standing_changed data v1 (LMS -> Space Booking, phase 3: not consumed yet)',
  type: 'object',
  required: ['memberId', 'eligible', 'reasons', 'accountStatus', 'membershipStatus', 'expiryDate', 'blockedUntil', 'evaluatedAt'],
  properties: {
    memberId: externalId,
    eligible: { type: 'boolean' },
    reasons: { type: 'array', uniqueItems: true, items: { enum: [...STANDING_REASONS] } },
    accountStatus: { enum: ['ACTIVE', 'DISABLED'] },
    membershipStatus: { enum: ['PENDING_DEPOSIT', 'ACTIVE', 'EXPIRED'] },
    expiryDate: { anyOf: [localDate, { type: 'null' }] },
    blockedUntil: nullableDateTime,
    evaluatedAt: dateTime,
  },
} as const;

export type Direction = 'publish' | 'consume';
export type Phase = 1 | 2 | 3;

export interface ContractEntry {
  routingKey: string;
  version: number;
  /** Who sends it, from our point of view. */
  direction: Direction;
  phase: Phase;
  /** Live today on our side. */
  implemented: boolean;
  schema: { $id: string };
}

const entry = (
  routingKey: string,
  direction: Direction,
  phase: Phase,
  implemented: boolean,
  schema: { $id: string },
): ContractEntry => ({ routingKey, version: 1, direction, phase, implemented, schema });

/** Every message in the Space Booking <-> LMS contract. */
export const CONTRACT: readonly ContractEntry[] = [
  ...BOOKING_ROUTING_KEYS.map((key) => entry(key, 'publish', 1, true, bookingV1)),
  entry('place.sync_applied', 'publish', 1, true, placeSyncAppliedV1),
  entry('place.sync_rejected', 'publish', 1, true, placeSyncRejectedV1),
  entry('booking.alert_due', 'publish', 2, false, bookingAlertDueV1),
  entry('identity.linked', 'publish', 2, false, identityV1),
  entry('identity.unlinked', 'publish', 2, false, identityV1),
  entry('place.created', 'consume', 1, true, placeSnapshotV1),
  entry('place.updated', 'consume', 1, true, placeSnapshotV1),
  entry('member.standing_changed', 'consume', 3, false, memberStandingChangedV1),
];

/** Every schema, keyed by the file name partners get in docs/integration/schemas/. */
export const SCHEMA_FILES: Record<string, object> = {
  'envelope.v1.json': envelopeV1,
  'booking.v1.json': bookingV1,
  'booking.alert_due.v1.json': bookingAlertDueV1,
  'place.snapshot.v1.json': placeSnapshotV1,
  'place.sync_applied.v1.json': placeSyncAppliedV1,
  'place.sync_rejected.v1.json': placeSyncRejectedV1,
  'identity.v1.json': identityV1,
  'member.standing_changed.v1.json': memberStandingChangedV1,
};

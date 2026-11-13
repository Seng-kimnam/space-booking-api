import type { OutboxEvent } from '../entities/outbox-event.entity';

/** Our broker username and app id (docs/integration/messaging-contract.md section 3.1). */
export const PRODUCER = 'space-booking';

/** The body every consumer receives (contract section 3.2). */
export interface Envelope {
  id: string;
  type: string;
  version: number;
  source: string;
  occurredAt: string;
  correlationId: string | null;
  subject: { type: string; id: string };
  data: Record<string, unknown>;
}

export interface OutgoingMessage {
  routingKey: string;
  body: Envelope;
  properties: {
    messageId: string;
    type: string;
    appId: string;
    // Validated by the broker against the connection's user: our sender proof.
    userId: string;
    contentType: 'application/json';
    contentEncoding: 'utf-8';
    persistent: true;
    timestamp: number;
    headers: Record<string, string>;
  };
}

/**
 * Optional booking.* fields are always sent, as null when they don't apply
 * (contract section 3.2). `external` is reserved for partner ids and stays null
 * until place sync with LMS exists (docs/integration/lms-booking-events-now.md).
 */
const BOOKING_NULL_DEFAULTS = {
  previousStartAt: null,
  previousEndAt: null,
  cancelReason: null,
  external: null,
} as const;

/**
 * place.sync_* replies are about the partner's place: their subject is the
 * partner place id (data.placeId), which the partner can look up. The outbox
 * row's aggregate_id is a uuid (our place id) and can't hold it.
 */
function subjectOf(row: OutboxEvent, data: Record<string, unknown>): Envelope['subject'] {
  if (row.eventType.startsWith('place.sync_') && typeof data.placeId === 'string')
    return { type: 'place', id: data.placeId };
  return { type: row.aggregateType, id: row.aggregateId };
}

/**
 * Outbox row -> AMQP message. The only place that knows the wire format, so
 * services keep writing plain outbox rows (contract section 3.3).
 */
export function toMessage(row: OutboxEvent): OutgoingMessage {
  const { schemaVersion, ...payload } = row.payload as {
    schemaVersion?: number;
  } & Record<string, unknown>;
  const version = typeof schemaVersion === 'number' ? schemaVersion : 1;
  const data =
    row.aggregateType === 'booking' ? { ...BOOKING_NULL_DEFAULTS, ...payload } : payload;
  // A v1 consumer bound to `booking.created` never gets a v2 body (contract section 5).
  const routingKey = version > 1 ? `${row.eventType}.v${version}` : row.eventType;

  return {
    routingKey,
    body: {
      id: row.id,
      type: row.eventType,
      version,
      source: PRODUCER,
      occurredAt: row.occurredAt.toISOString(),
      correlationId: null,
      subject: subjectOf(row, data),
      data,
    },
    properties: {
      messageId: row.id,
      type: row.eventType,
      appId: PRODUCER,
      userId: PRODUCER,
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      persistent: true,
      timestamp: Math.floor(row.occurredAt.getTime() / 1000),
      headers: { 'x-schema-version': String(version) },
    },
  };
}

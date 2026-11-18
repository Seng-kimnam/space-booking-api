import type { OutboxEvent } from '../entities/outbox-event.entity';
import { toMessage } from './envelope';

const occurredAt = new Date('2026-11-09T10:15:00.000Z');

function row(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: '0b8f5a8e-6a0f-4f0a-9c51-2b1f0e7d9a10',
    aggregateType: 'booking',
    aggregateId: '7d0e0000-0000-4000-8000-000000000001',
    eventType: 'booking.created',
    payload: {
      schemaVersion: 1,
      bookingId: '7d0e0000-0000-4000-8000-000000000001',
      status: 'PENDING',
    },
    occurredAt,
    publishedAt: null,
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe('toMessage', () => {
  it('sets every AMQP property from the row (contract section 3.1)', () => {
    const { routingKey, properties } = toMessage(row());
    expect(routingKey).toBe('booking.created');
    expect(properties).toEqual({
      messageId: '0b8f5a8e-6a0f-4f0a-9c51-2b1f0e7d9a10',
      type: 'booking.created',
      appId: 'space-booking',
      userId: 'space-booking',
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      persistent: true,
      timestamp: Math.floor(occurredAt.getTime() / 1000),
      headers: { 'x-schema-version': '1' },
    });
  });

  it('builds the envelope and strips schemaVersion from data', () => {
    const { body } = toMessage(row());
    expect(body).toEqual({
      id: '0b8f5a8e-6a0f-4f0a-9c51-2b1f0e7d9a10',
      type: 'booking.created',
      version: 1,
      source: 'space-booking',
      occurredAt: '2026-11-09T10:15:00.000Z',
      correlationId: null,
      subject: { type: 'booking', id: '7d0e0000-0000-4000-8000-000000000001' },
      data: {
        bookingId: '7d0e0000-0000-4000-8000-000000000001',
        status: 'PENDING',
        previousStartAt: null,
        previousEndAt: null,
        cancelReason: null,
        external: null,
      },
    });
    expect(body.data).not.toHaveProperty('schemaVersion');
  });

  it('keeps previous range values when the payload has them', () => {
    const { body } = toMessage(
      row({
        eventType: 'booking.modified',
        payload: {
          schemaVersion: 1,
          previousStartAt: '2026-11-10T01:00:00.000Z',
          previousEndAt: '2026-11-10T03:00:00.000Z',
        },
      }),
    );
    expect(body.data.previousStartAt).toBe('2026-11-10T01:00:00.000Z');
    expect(body.data.previousEndAt).toBe('2026-11-10T03:00:00.000Z');
  });

  it('adds the .vN suffix only from version 2 on (contract section 5)', () => {
    const v2 = toMessage(row({ payload: { schemaVersion: 2 } }));
    expect(v2.routingKey).toBe('booking.created.v2');
    expect(v2.body.type).toBe('booking.created');
    expect(v2.body.version).toBe(2);
    expect(v2.properties.headers['x-schema-version']).toBe('2');

    const noVersion = toMessage(row({ payload: {} }));
    expect(noVersion.routingKey).toBe('booking.created');
    expect(noVersion.body.version).toBe(1);
  });

  it('uses the partner place id as subject of place.sync_* replies', () => {
    const { body } = toMessage(
      row({
        aggregateType: 'place',
        eventType: 'place.sync_rejected',
        payload: { schemaVersion: 1, placeId: '1', revision: 3 },
      }),
    );
    expect(body.subject).toEqual({ type: 'place', id: '1' });
    expect(body.data).toEqual({ placeId: '1', revision: 3 });
  });

  it('does not add booking defaults to other aggregates', () => {
    const { body } = toMessage(
      row({ aggregateType: 'seat', eventType: 'seat.status_changed', payload: { status: 'ACTIVE' } }),
    );
    expect(body.data).toEqual({ status: 'ACTIVE' });
  });
});

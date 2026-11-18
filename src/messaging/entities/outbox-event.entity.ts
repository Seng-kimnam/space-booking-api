import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Events we publish. Written in the same transaction as the domain change; the
// outbox relay job publishes them to RabbitMQ. No FKs on purpose: it's a message
// log, decoupled from the rows it describes.
@Entity({ name: 'outbox_events' })
@Check('outbox_events_attempts_chk', 'attempts >= 0')
@Index('outbox_events_unpublished_idx', ['occurredAt'], {
  where: 'published_at IS NULL',
})
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'outbox_events_pkey',
  })
  id: string;

  // booking, seat, place, user
  @Column({ name: 'aggregate_type', type: 'varchar', length: 50 })
  aggregateType: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId: string;

  // RabbitMQ routing key (docs/api-endpoints.md section 9).
  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  // No secrets or token fields.
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}

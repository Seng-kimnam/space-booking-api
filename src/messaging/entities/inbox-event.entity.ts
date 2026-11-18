import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

// Messages we consume (RabbitMQ, Telegram webhook). Inserting the row first makes
// consumers idempotent: a duplicate (source, message_id) fails the unique key.
@Entity({ name: 'inbox_events' })
@Unique('inbox_events_source_message_uk', ['source', 'messageId'])
export class InboxEvent {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'inbox_events_pkey',
  })
  id: string;

  // 'telegram' or the producing service.
  @Column({ type: 'varchar', length: 100 })
  source: string;

  // RabbitMQ message_id / Telegram update_id.
  @Column({ name: 'message_id', type: 'varchar', length: 100 })
  messageId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}

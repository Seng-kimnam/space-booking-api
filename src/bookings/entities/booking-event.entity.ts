import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BookingEventType } from '../../common/enums';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import { tstzrangeTransformer } from '../../database/transformers/tstzrange.transformer';
import { User } from '../../users/entities/user.entity';
import { Booking } from './booking.entity';

// Append-only history of a booking. Written in the same transaction as the change.
@Entity({ name: 'booking_events' })
@Check(
  'booking_events_actor_chk',
  'actor_system OR actor_user_id IS NOT NULL OR actor_client_id IS NOT NULL',
)
@Index('booking_events_booking_idx', ['bookingId', 'createdAt'])
export class BookingEvent {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'booking_events_pkey',
  })
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'booking_id',
    foreignKeyConstraintName: 'booking_events_booking_id_fkey',
  })
  booking: Booking;

  @Column({
    type: 'enum',
    enum: BookingEventType,
    enumName: 'booking_event_type',
  })
  type: BookingEventType;

  // Set for MODIFIED / EXTENDED.
  @Column({
    name: 'old_range',
    type: 'tstzrange',
    nullable: true,
    transformer: tstzrangeTransformer,
  })
  oldRange: TimeRange | null;

  @Column({
    name: 'new_range',
    type: 'tstzrange',
    nullable: true,
    transformer: tstzrangeTransformer,
  })
  newRange: TimeRange | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => User, {
    name: 'booking_events_actor_user_id_fkey',
    onDelete: 'SET NULL',
  })
  actorUserId: string | null;

  // FK by table name: bookings doesn't import the api-clients module.
  @Column({ name: 'actor_client_id', type: 'uuid', nullable: true })
  @ForeignKey('api_clients', {
    name: 'booking_events_actor_client_id_fkey',
    onDelete: 'SET NULL',
  })
  actorClientId: string | null;

  // true for scheduled jobs (expire, overdue).
  @Column({ name: 'actor_system', type: 'boolean', default: false })
  actorSystem: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

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
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '../../common/enums';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'notifications' })
// EMAIL is for auth OTPs only; booking alerts go to TELEGRAM.
@Check(
  'notifications_channel_type_chk',
  `(channel = 'EMAIL') = (type IN ('EMAIL_VERIFY_OTP', 'PASSWORD_RESET_OTP'))`,
)
@Check(
  'notifications_sent_consistent',
  `(status = 'SENT') = (sent_at IS NOT NULL)`,
)
@Check('notifications_attempts_chk', 'attempts >= 0')
// Jobs can run repeatedly without double-sending. Only for alerts that happen
// once per booking: BOOKING_MODIFIED / BOOKING_EXTENDED / CHECKED_IN / CHECKED_OUT
// are sent once per change.
@Index(
  'notifications_booking_type_channel_uk',
  ['bookingId', 'type', 'channel'],
  {
    unique: true,
    where: `booking_id IS NOT NULL AND type IN ('BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'LATE_CHECKIN', 'CHECKOUT_REMINDER', 'BOOKING_EXPIRED', 'FORGOTTEN_CHECKOUT')`,
  },
)
@Index('notifications_pending_due_idx', ['scheduledAt'], {
  where: `status = 'PENDING'`,
})
// DESC index TypeORM can't express; it lives in the migration only.
@Index('notifications_user_created_idx', { synchronize: false })
export class Notification {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'notifications_pkey',
  })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'notifications_user_id_fkey',
  })
  user: User;

  // NULL for auth emails. FK by table name: bookings imports notifications,
  // so notifications must not import bookings (docs/project-structure.md section 3).
  @Column({ name: 'booking_id', type: 'uuid', nullable: true })
  @ForeignKey('bookings', {
    name: 'notifications_booking_id_fkey',
    onDelete: 'CASCADE',
  })
  bookingId: string | null;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    enumName: 'notification_channel',
  })
  channel: NotificationChannel;

  @Column({
    type: 'enum',
    enum: NotificationType,
    enumName: 'notification_type',
  })
  type: NotificationType;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    enumName: 'notification_status',
    default: NotificationStatus.PENDING,
  })
  status: NotificationStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', default: () => 'now()' })
  scheduledAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  // Template data. Never OTP codes or tokens.
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

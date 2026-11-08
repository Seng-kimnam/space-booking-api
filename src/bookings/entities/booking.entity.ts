import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import {
  AttendanceMethod,
  BookingSource,
  BookingStatus,
} from '../../common/enums';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import { tstzrangeTransformer } from '../../database/transformers/tstzrange.transformer';
import { Seat } from '../../seats/entities/seat.entity';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'bookings' })
// Core guarantee: no double-booking, enforced by Postgres (AGENTS.md section 6.1).
// Also guards modify / extend UPDATEs. A violation is SQLSTATE 23P01, which the
// bookings repository maps to 409 Conflict. Declared here so migration:generate
// keeps it instead of dropping it; the migration owns the actual DDL.
@Exclusion(
  'no_double_booking',
  `USING gist (seat_id WITH =, time_range WITH &&) WHERE (status IN ('PENDING', 'CHECKED_IN', 'CHECKOUT_OVERDUE'))`,
)
// Half-open, bounded, non-empty ranges.
@Check(
  'bookings_range_valid',
  'NOT isempty(time_range) AND lower_inc(time_range) AND NOT upper_inc(time_range) AND NOT lower_inf(time_range) AND NOT upper_inf(time_range)',
)
// Timestamps must match status (docs/erd.md section 5). The service layer
// enforces the same rules; these are the last line of defence.
@Check(
  'bookings_cancel_consistent',
  `(status = 'CANCELLED') = (cancelled_at IS NOT NULL)`,
)
@Check(
  'bookings_expire_consistent',
  `(status = 'EXPIRED') = (expired_at IS NOT NULL)`,
)
@Check(
  'bookings_checkin_consistent',
  `(status IN ('CHECKED_IN', 'CHECKOUT_OVERDUE', 'COMPLETED')) = (checked_in_at IS NOT NULL)`,
)
@Check(
  'bookings_checkout_consistent',
  `((status = 'COMPLETED') = (checked_out_at IS NOT NULL)) AND (checked_out_at IS NULL OR checked_out_at >= checked_in_at)`,
)
@Check(
  'bookings_checkin_method_chk',
  '(checked_in_at IS NULL) = (check_in_method IS NULL)',
)
@Check(
  'bookings_checkout_method_chk',
  '(checked_out_at IS NULL) = (check_out_method IS NULL)',
)
// client_id is set exactly when the booking came from an API client.
@Check(
  'bookings_client_consistent',
  `(source = 'API_CLIENT') = (client_id IS NOT NULL)`,
)
@Check('bookings_extension_count_chk', 'extension_count >= 0')
// A retried POST /bookings with the same Idempotency-Key returns the original booking.
@Index('bookings_user_idempotency_uk', ['userId', 'idempotencyKey'], {
  unique: true,
  where: 'idempotency_key IS NOT NULL',
})
@Index('bookings_client_idx', ['clientId'], { where: 'client_id IS NOT NULL' })
// DESC / expression indexes TypeORM can't express; they live in the migration only.
@Index('bookings_user_created_idx', { synchronize: false })
@Index('bookings_status_start_idx', { synchronize: false })
@Index('bookings_status_end_idx', { synchronize: false })
export class Booking {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'bookings_pkey' })
  id: string;

  @Column({ name: 'seat_id', type: 'uuid' })
  seatId: string;

  @ManyToOne(() => Seat, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'seat_id',
    foreignKeyConstraintName: 'bookings_seat_id_fkey',
  })
  seat: Seat;

  // Always set (no walk-ins), including bookings made by an API client or admin.
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'bookings_user_id_fkey',
  })
  user: User;

  // FK by table name: bookings doesn't import the api-clients module
  // (docs/project-structure.md section 3).
  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  @ForeignKey('api_clients', {
    name: 'bookings_client_id_fkey',
    onDelete: 'RESTRICT',
  })
  clientId: string | null;

  @Column({
    type: 'enum',
    enum: BookingSource,
    enumName: 'booking_source',
    default: BookingSource.APP,
  })
  source: BookingSource;

  // [start, end). Overlap and lower()/upper() queries belong in the bookings repository.
  @Column({
    name: 'time_range',
    type: 'tstzrange',
    transformer: tstzrangeTransformer,
  })
  timeRange: TimeRange;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    enumName: 'booking_status',
    default: BookingStatus.PENDING,
  })
  status: BookingStatus;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt: Date | null;

  @Column({ name: 'checked_in_by', type: 'uuid', nullable: true })
  @ForeignKey(() => User, {
    name: 'bookings_checked_in_by_fkey',
    onDelete: 'RESTRICT',
  })
  checkedInBy: string | null;

  @Column({
    name: 'check_in_method',
    type: 'enum',
    enum: AttendanceMethod,
    enumName: 'attendance_method',
    nullable: true,
  })
  checkInMethod: AttendanceMethod | null;

  @Column({ name: 'checked_out_at', type: 'timestamptz', nullable: true })
  checkedOutAt: Date | null;

  @Column({ name: 'checked_out_by', type: 'uuid', nullable: true })
  @ForeignKey(() => User, {
    name: 'bookings_checked_out_by_fkey',
    onDelete: 'RESTRICT',
  })
  checkedOutBy: string | null;

  @Column({
    name: 'check_out_method',
    type: 'enum',
    enum: AttendanceMethod,
    enumName: 'attendance_method',
    nullable: true,
  })
  checkOutMethod: AttendanceMethod | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true })
  @ForeignKey(() => User, {
    name: 'bookings_cancelled_by_fkey',
    onDelete: 'RESTRICT',
  })
  cancelledBy: string | null;

  @Column({
    name: 'cancel_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  cancelReason: string | null;

  @Column({ name: 'expired_at', type: 'timestamptz', nullable: true })
  expiredAt: Date | null;

  @Column({ name: 'extension_count', type: 'smallint', default: 0 })
  extensionCount: number;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  idempotencyKey: string | null;

  // Optimistic lock: rejects concurrent modify / extend of the same booking.
  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

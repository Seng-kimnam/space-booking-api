import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { QrPurpose } from '../../common/enums';
import { Booking } from './booking.entity';

// One-time check-in / check-out QR. Marked used in the same transaction as the
// status change; revoked when a new one is issued (AGENTS.md section 6.3).
@Entity({ name: 'booking_qr_tokens' })
@Unique('booking_qr_tokens_token_hash_uk', ['tokenHash'])
// At most one live QR per booking and action.
@Index('booking_qr_tokens_live_uk', ['bookingId', 'purpose'], {
  unique: true,
  where: 'used_at IS NULL AND revoked_at IS NULL',
})
@Index('booking_qr_tokens_booking_idx', ['bookingId'])
export class BookingQrToken {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'booking_qr_tokens_pkey',
  })
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'booking_id',
    foreignKeyConstraintName: 'booking_qr_tokens_booking_id_fkey',
  })
  booking: Booking;

  @Column({ type: 'enum', enum: QrPurpose, enumName: 'qr_purpose' })
  purpose: QrPurpose;

  // Hash only; the QR encodes the raw token.
  @Column({ name: 'token_hash', type: 'varchar', length: 255 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

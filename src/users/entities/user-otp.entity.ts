import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OtpPurpose } from '../../common/enums';
import { User } from './user.entity';

@Entity({ name: 'user_otps' })
@Check('user_otps_attempts_chk', 'attempts >= 0')
// At most one live code per user and purpose.
@Index('user_otps_live_uk', ['userId', 'purpose'], {
  unique: true,
  where: 'used_at IS NULL',
})
@Index('user_otps_user_purpose_idx', ['userId', 'purpose'])
export class UserOtp {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'user_otps_pkey',
  })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'user_otps_user_id_fkey',
  })
  user: User;

  @Column({ type: 'enum', enum: OtpPurpose, enumName: 'otp_purpose' })
  purpose: OtpPurpose;

  // Hash only, never the code itself.
  @Column({ name: 'code_hash', type: 'varchar', length: 255 })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  @Column({ name: 'last_sent_at', type: 'timestamptz', default: () => 'now()' })
  lastSentAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

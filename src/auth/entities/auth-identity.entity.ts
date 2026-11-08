import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AuthProvider } from '../../common/enums';
import { User } from '../../users/entities/user.entity';

// Social accounts are matched on (provider, provider_user_id), never on email.
@Entity({ name: 'auth_identities' })
@Unique('auth_identities_provider_account_uk', ['provider', 'providerUserId'])
@Unique('auth_identities_user_provider_uk', ['userId', 'provider'])
@Index('auth_identities_user_idx', ['userId'])
export class AuthIdentity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'auth_identities_pkey',
  })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'auth_identities_user_id_fkey',
  })
  user: User;

  @Column({ type: 'enum', enum: AuthProvider, enumName: 'auth_provider' })
  provider: AuthProvider;

  // Google "sub" / Facebook user id.
  @Column({ name: 'provider_user_id', type: 'varchar', length: 255 })
  providerUserId: string;

  @Column({ name: 'provider_email', type: 'citext', nullable: true })
  providerEmail: string | null;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  displayName: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'linked_at', type: 'timestamptz', default: () => 'now()' })
  linkedAt: Date;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;
}

import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums';

@Entity({ name: 'users' })
@Unique('users_email_uk', ['email'])
@Check('users_no_show_count_chk', 'no_show_count >= 0')
export class User {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'users_pkey' })
  id: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    enumName: 'user_role',
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'citext' })
  email: string;

  // NULL for social-only accounts. Not selected by default so it can't leak by
  // accident; the auth service opts in with addSelect('user.passwordHash').
  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  passwordHash: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'no_show_count', type: 'integer', default: 0 })
  noShowCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}

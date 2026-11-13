import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../roles/entities/role.entity';

export enum UserRole {
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  USER = 'USER',
}

export enum AdminRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Exclude()
  passwordHash: string | null;

  // Column exists since the initial schema; mapped for PATCH /users/me.
  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  // Password-reset codes live in user_otps (purpose PASSWORD_RESET), not on users
  // (AGENTS.md section 5, docs/erd.md).

  // false = suspended: login and refresh are refused (AuthService). The column
  // has existed since the initial schema; it just wasn't mapped.
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'no_show_count', type: 'int', default: 0 })
  noShowCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Role, { eager: true, nullable: false })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({
    name: 'admin_request_status',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  adminRequestStatus: AdminRequestStatus | null;

  @Column({ name: 'admin_requested_at', type: 'timestamptz', nullable: true })
  adminRequestedAt: Date | null;

  @Column({ name: 'admin_approved_at', type: 'timestamptz', nullable: true })
  adminApprovedAt: Date | null;

  @Column({ name: 'admin_approved_by', type: 'uuid', nullable: true })
  adminApprovedById: string | null;

  @Column({
    name: 'google_id',
    type: 'varchar',
    length: 255,
    unique: true,
    nullable: true,
  })
  googleId: string | null;
}

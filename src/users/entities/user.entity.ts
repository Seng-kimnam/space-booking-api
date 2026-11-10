import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../../roles/entities/role.entity';

export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  @Exclude()
  passwordHash: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  // Password-reset codes live in user_otps (purpose PASSWORD_RESET), not on users
  // (AGENTS.md section 5, docs/erd.md).

  @Column({ name: 'no_show_count', type: 'int', default: 0 })
  noShowCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Role, { eager: true, nullable: false })
  @JoinColumn({ name: 'role_id' })
  role: Role;
}

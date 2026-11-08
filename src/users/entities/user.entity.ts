import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

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
  

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  @Exclude()
  passwordHash: string;

  @Column({
    name: 'reset_token_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Exclude()
  resetTokenHash: string | null;

  @Column({
    name: 'reset_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  @Exclude()
  resetTokenExpiresAt: Date | null;

  @Column({ name: 'no_show_count', type: 'int', default: 0 })
  noShowCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Foreign keys only. No imports of Role/Place, so no conflicts with teammates' entities.
  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ name: 'place_id', type: 'uuid', nullable: true })
  placeId: string | null;
}

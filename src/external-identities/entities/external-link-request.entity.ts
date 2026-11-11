import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ApiClient } from '../../api-clients/entities/api-client.entity';

/**
 * One-time code a partner requested to link one of its members (proposal
 * section 6.4). Hash only, single use, short-lived, like user_otps
 * (AGENTS.md section 6.8).
 */
@Entity({ name: 'external_link_requests' })
@Unique('external_link_requests_code_hash_uk', ['codeHash'])
@Index('external_link_requests_member_idx', ['externalSystem', 'externalUserId'])
export class ExternalLinkRequest {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'external_link_requests_pkey' })
  id: string;

  @Column({ name: 'external_system', type: 'varchar', length: 30 })
  externalSystem: string;

  @Column({ name: 'external_user_id', type: 'varchar', length: 64 })
  externalUserId: string;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @ManyToOne(() => ApiClient, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id', foreignKeyConstraintName: 'external_link_requests_client_id_fkey' })
  client: ApiClient | null;

  // sha256 hex of the code.
  @Column({ name: 'code_hash', type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

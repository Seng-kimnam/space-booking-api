import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ApiClient } from '../../api-clients/entities/api-client.entity';
import { User } from '../../users/entities/user.entity';

/**
 * One of our users linked to their account in a partner system (LMS member).
 * Created only by the explicit link flow, never by matching emails
 * (docs/integration/service-authentication.md section 4, decision D11).
 * One member <-> one user per partner system.
 */
@Entity({ name: 'external_identities' })
@Unique('external_identities_member_uk', ['externalSystem', 'externalUserId'])
@Unique('external_identities_user_uk', ['externalSystem', 'userId'])
export class ExternalIdentity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'external_identities_pkey' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'external_identities_user_id_fkey' })
  user: User;

  // 'library' = LMS (same value as places.external_system).
  @Column({ name: 'external_system', type: 'varchar', length: 30 })
  externalSystem: string;

  // The partner's user id (LMS members.id as a string).
  @Column({ name: 'external_user_id', type: 'varchar', length: 64 })
  externalUserId: string;

  // API client that started the link (audit); NULL if that client was deleted.
  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @ManyToOne(() => ApiClient, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id', foreignKeyConstraintName: 'external_identities_client_id_fkey' })
  client: ApiClient | null;

  @Column({ name: 'linked_at', type: 'timestamptz', default: () => 'now()' })
  linkedAt: Date;

  // Latest member.standing_changed (phase 3). NULL = never received.
  @Column({ name: 'standing_eligible', type: 'boolean', nullable: true })
  standingEligible: boolean | null;

  @Column({ name: 'standing_reasons', type: 'text', array: true, default: () => "'{}'" })
  standingReasons: string[];

  // Membership expiry, local date. Expired => ineligible even before the next event.
  @Column({ name: 'standing_expiry_date', type: 'date', nullable: true })
  standingExpiryDate: string | null;

  // evaluatedAt of the stored standing; older events are ignored.
  @Column({ name: 'standing_evaluated_at', type: 'timestamptz', nullable: true })
  standingEvaluatedAt: Date | null;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

// An integrating app that calls the REST API with an API key (not JWT).
@Entity({ name: 'api_clients' })
@Unique('api_clients_name_uk', ['name'])
@Unique('api_clients_api_key_hash_uk', ['apiKeyHash'])
export class ApiClient {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'api_clients_pkey',
  })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 12 })
  keyPrefix: string;

  @Column({ name: 'api_key_hash', type: 'varchar', length: 255 })
  apiKeyHash: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  scopes: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Place } from '../../places/entities/place.entity';

@Entity({ name: 'areas' })
// Target of the composite FK from seats, which keeps a seat's area in the same place.
@Unique('areas_id_place_uk', ['id', 'placeId'])
// Name is unique per place among non-deleted areas only.
@Index('areas_place_name_uk', ['placeId', 'name'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('areas_place_idx', ['placeId'])
// Includes soft-deleted rows: a returning partner area is restored, not duplicated.
@Index('areas_place_external_uk', ['placeId', 'externalId'], {
  unique: true,
  where: 'external_id IS NOT NULL',
})
export class Area {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'areas_pkey' })
  id: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId: string;

  @ManyToOne(() => Place, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'place_id',
    foreignKeyConstraintName: 'areas_place_id_fkey',
  })
  place: Place;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  floor: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // Partner's area id when the place is partner-managed (places.external_system).
  @Column({ name: 'external_id', type: 'varchar', length: 64, nullable: true })
  externalId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}

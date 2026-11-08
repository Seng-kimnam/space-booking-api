import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SeatStatus } from '../../common/enums';
import { Area } from '../../areas/entities/area.entity';
import { Place } from '../../places/entities/place.entity';

// No is_available column: availability is derived from bookings (AGENTS.md section 6.2).
@Entity({ name: 'seats' })
// (area_id, place_id) -> areas (id, place_id): a seat's area must belong to the
// same place. MATCH SIMPLE, so it is skipped when area_id is NULL.
@ForeignKey(() => Area, ['areaId', 'placeId'], ['id', 'placeId'], {
  name: 'seats_area_same_place_fk',
  onDelete: 'RESTRICT',
})
@Index('seats_place_label_uk', ['placeId', 'label'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('seats_place_area_idx', ['placeId', 'areaId'])
// GIN index; TypeORM can't express the index method, so it lives in the migration only.
@Index('seats_features_gin_idx', { synchronize: false })
export class Seat {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'seats_pkey' })
  id: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId: string;

  @ManyToOne(() => Place, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'place_id',
    foreignKeyConstraintName: 'seats_place_id_fkey',
  })
  place: Place;

  // NULL = seat has no area.
  @Column({ name: 'area_id', type: 'uuid', nullable: true })
  areaId: string | null;

  // Navigation only: the real FK is the composite one declared on the class.
  @ManyToOne(() => Area, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'area_id' })
  area: Area | null;

  @Column({ type: 'varchar', length: 30 })
  label: string;

  // e.g. { "power": true, "window": false, "desk": "large" }
  @Column({ type: 'jsonb', default: () => "'{}'" })
  features: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: SeatStatus,
    enumName: 'seat_status',
    default: SeatStatus.ACTIVE,
  })
  status: SeatStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}

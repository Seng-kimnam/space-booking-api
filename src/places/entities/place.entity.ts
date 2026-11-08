import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PlaceType } from '../../common/enums';

@Entity({ name: 'places' })
@Check('places_lat_chk', 'lat BETWEEN -90 AND 90')
@Check('places_lng_chk', 'lng BETWEEN -180 AND 180')
export class Place {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'places_pkey' })
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'enum', enum: PlaceType, enumName: 'place_type' })
  type: PlaceType;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255 })
  address: string;

  @Column({ type: 'double precision', nullable: true })
  lat: number | null;

  @Column({ type: 'double precision', nullable: true })
  lng: number | null;

  // IANA zone name (e.g. Asia/Phnom_Penh), validated in the app. Times are
  // stored in UTC and only converted to this zone for output and opening hours.
  // Defaults to Cambodia time (UTC+7, no DST) since our places are in Cambodia.
  @Column({ type: 'varchar', length: 64, default: 'Asia/Phnom_Penh' })
  timezone: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}

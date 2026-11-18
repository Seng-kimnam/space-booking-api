import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PlaceType } from '../../common/enums';

@Entity({ name: 'places' })
@Check('places_lat_chk', 'lat BETWEEN -90 AND 90')
@Check('places_lng_chk', 'lng BETWEEN -180 AND 180')
@Check(
  'places_external_chk',
  '("external_system" IS NULL AND "external_id" IS NULL AND "external_revision" IS NULL AND "external_open" IS NULL) OR ("external_system" IS NOT NULL AND "external_id" IS NOT NULL AND "external_revision" IS NOT NULL AND "external_open" IS NOT NULL)',
)
@Check('places_external_revision_chk', '"external_revision" >= 0')
@Index('places_external_uk', ['externalSystem', 'externalId'], {
  unique: true,
  where: 'external_id IS NOT NULL',
})
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

  // Our go-live switch. For a partner-managed place, booking also needs external_open.
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // Partner that manages this place ('library' = LMS), NULL when our admins do.
  // Partner-managed fields can't be edited here (docs/lms-integration-proposal.md section 3.1).
  @Column({ name: 'external_system', type: 'varchar', length: 30, nullable: true })
  externalSystem: string | null;

  // The partner's place id (LMS ids are bigints sent as strings).
  @Column({ name: 'external_id', type: 'varchar', length: 64, nullable: true })
  externalId: string | null;

  // Last applied snapshot revision; older or equal snapshots are ignored.
  // bigint comes back from pg as a string.
  @Column({ name: 'external_revision', type: 'bigint', nullable: true })
  externalRevision: string | null;

  // Partner says the place is open for booking (status ACTIVE and bookingEnabled).
  @Column({ name: 'external_open', type: 'boolean', nullable: true })
  externalOpen: boolean | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}

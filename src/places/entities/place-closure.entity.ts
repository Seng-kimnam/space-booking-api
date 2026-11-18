import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Place } from './place.entity';

@Entity({ name: 'place_closures' })
@Unique('place_closures_place_date_uk', ['placeId', 'date'])
export class PlaceClosure {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'place_closures_pkey',
  })
  id: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId: string;

  @ManyToOne(() => Place, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'place_id',
    foreignKeyConstraintName: 'place_closures_place_id_fkey',
  })
  place: Place;

  // 'YYYY-MM-DD' local date in places.timezone. Kept as a string so it is
  // never shifted by the Node process timezone.
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;
}

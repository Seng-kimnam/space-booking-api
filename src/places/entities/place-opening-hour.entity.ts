import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Place } from './place.entity';

@Entity({ name: 'place_opening_hours' })
@Unique('place_opening_hours_place_weekday_uk', ['placeId', 'weekday'])
@Check('place_opening_hours_weekday_chk', 'weekday BETWEEN 0 AND 6')
@Check(
  'place_opening_hours_times_chk',
  'closes_next_day OR open_time < close_time',
)
export class PlaceOpeningHour {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'place_opening_hours_pkey',
  })
  id: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId: string;

  @ManyToOne(() => Place, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'place_id',
    foreignKeyConstraintName: 'place_opening_hours_place_id_fkey',
  })
  place: Place;

  // 0 = Sunday .. 6 = Saturday, in the place's timezone.
  @Column({ type: 'smallint' })
  weekday: number;

  // 'HH:mm:ss' local time (pg returns `time` as a string).
  @Column({ name: 'open_time', type: 'time' })
  openTime: string;

  @Column({ name: 'close_time', type: 'time' })
  closeTime: string;

  // Overnight venues: close_time is on the following day.
  @Column({ name: 'closes_next_day', type: 'boolean', default: false })
  closesNextDay: boolean;
}

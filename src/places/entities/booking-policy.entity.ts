import {
  Check,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Place } from './place.entity';

// One row per place. Grace period, reminders and limits always come from here;
// never hardcode them (AGENTS.md section 5).
@Entity({ name: 'booking_policies' })
@Check('booking_policies_grace_chk', 'checkin_grace_minutes >= 0')
@Check('booking_policies_reminder_chk', 'checkout_reminder_minutes >= 0')
@Check('booking_policies_overdue_chk', 'overdue_alert_minutes >= 0')
@Check('booking_policies_min_chk', 'min_minutes >= 1')
@Check('booking_policies_max_chk', 'max_minutes >= min_minutes')
@Check('booking_policies_slot_chk', 'slot_minutes >= 1')
@Check('booking_policies_advance_chk', 'max_advance_days >= 0')
@Check('booking_policies_active_chk', 'max_active_per_user >= 1')
@Check('booking_policies_extensions_chk', 'max_extensions >= 0')
@Check('booking_policies_modify_cutoff_chk', 'modify_cutoff_minutes >= 0')
export class BookingPolicy {
  @PrimaryColumn({
    name: 'place_id',
    type: 'uuid',
    primaryKeyConstraintName: 'booking_policies_pkey',
  })
  placeId: string;

  @OneToOne(() => Place, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'place_id',
    foreignKeyConstraintName: 'booking_policies_place_id_fkey',
  })
  place: Place;

  @Column({ name: 'checkin_grace_minutes', type: 'smallint', default: 15 })
  checkinGraceMinutes: number;

  @Column({ name: 'checkout_reminder_minutes', type: 'smallint', default: 15 })
  checkoutReminderMinutes: number;

  @Column({ name: 'overdue_alert_minutes', type: 'smallint', default: 15 })
  overdueAlertMinutes: number;

  @Column({ name: 'min_minutes', type: 'smallint', default: 30 })
  minMinutes: number;

  @Column({ name: 'max_minutes', type: 'smallint', default: 240 })
  maxMinutes: number;

  @Column({ name: 'slot_minutes', type: 'smallint', default: 15 })
  slotMinutes: number;

  @Column({ name: 'max_advance_days', type: 'smallint', default: 7 })
  maxAdvanceDays: number;

  @Column({ name: 'max_active_per_user', type: 'smallint', default: 1 })
  maxActivePerUser: number;

  @Column({ name: 'max_extensions', type: 'smallint', default: 2 })
  maxExtensions: number;

  @Column({ name: 'modify_cutoff_minutes', type: 'smallint', default: 30 })
  modifyCutoffMinutes: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

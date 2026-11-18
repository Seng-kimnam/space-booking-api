import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - bookings.group_id: links the bookings created by one multi-seat request, so
 *   they can share one check-in/out QR and one Telegram message. Single-seat
 *   bookings get a group of one. Nullable so existing rows stay valid.
 * - booking_policies.late_checkin_alert_minutes: when the "you are late" Telegram
 *   alert fires (start + N). Must not be after the expiry (start + grace).
 */
export class BookingGroupsAndLateAlert1794135245903 implements MigrationInterface {
  name = 'BookingGroupsAndLateAlert1794135245903';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" ADD "group_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "bookings_group_idx" ON "bookings" ("group_id") WHERE group_id IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_policies" ADD "late_checkin_alert_minutes" smallint NOT NULL DEFAULT '5'`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_late_alert_chk" CHECK (late_checkin_alert_minutes >= 0 AND late_checkin_alert_minutes <= checkin_grace_minutes)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "booking_policies" DROP CONSTRAINT "booking_policies_late_alert_chk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_policies" DROP COLUMN "late_checkin_alert_minutes"`,
    );
    await queryRunner.query(`DROP INDEX "public"."bookings_group_idx"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN "group_id"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Telegram alerts for every booking change, not only create/cancel/expire/overdue:
 * - notification_type gets BOOKING_MODIFIED, BOOKING_EXTENDED, CHECKED_IN, CHECKED_OUT.
 * - notifications_booking_type_channel_uk ("one per booking, type, channel") now
 *   covers only the alerts that happen once per booking. A booking can be
 *   modified or extended several times, and each change gets its own alert.
 */
const ONCE_PER_BOOKING = `'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'LATE_CHECKIN',
  'CHECKOUT_REMINDER', 'BOOKING_EXPIRED', 'FORGOTTEN_CHECKOUT'`;

const OLD_TYPES = `'EMAIL_VERIFY_OTP', 'PASSWORD_RESET_OTP', ${ONCE_PER_BOOKING}`;
const NEW_TYPES = ['BOOKING_MODIFIED', 'BOOKING_EXTENDED', 'CHECKED_IN', 'CHECKED_OUT'];

export class BookingChangeAlerts1794160000000 implements MigrationInterface {
  name = 'BookingChangeAlerts1794160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Allowed inside a transaction (PG 12+) as long as the new values aren't used
    // in the same transaction, which is why the index below lists the old ones.
    for (const value of NEW_TYPES) {
      await queryRunner.query(
        `ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
    await queryRunner.query(`DROP INDEX "public"."notifications_booking_type_channel_uk"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "notifications_booking_type_channel_uk"
         ON "notifications" ("booking_id", "type", "channel")
         WHERE booking_id IS NOT NULL AND type IN (${ONCE_PER_BOOKING})`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't drop enum values: rebuild the type without them.
    await queryRunner.query(
      `DELETE FROM "notifications" WHERE type::text IN (${NEW_TYPES.map((t) => `'${t}'`).join(', ')})`,
    );
    await queryRunner.query(`DROP INDEX "public"."notifications_booking_type_channel_uk"`);
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "notifications_channel_type_chk"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type" RENAME TO "notification_type_old"`,
    );
    await queryRunner.query(`CREATE TYPE "public"."notification_type" AS ENUM(${OLD_TYPES})`);
    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notification_type"
         USING "type"::text::"public"."notification_type"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notification_type_old"`);
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channel_type_chk"
         CHECK ((channel = 'EMAIL') = (type IN ('EMAIL_VERIFY_OTP', 'PASSWORD_RESET_OTP')))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "notifications_booking_type_channel_uk"
         ON "notifications" ("booking_id", "type", "channel") WHERE booking_id IS NOT NULL`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Email change with OTP (docs/api-endpoints.md 9e/9f): the new address waits
 * in users.pending_email until the EMAIL_CHANGE code mailed to it is confirmed.
 */
export class EmailChange1794340000000 implements MigrationInterface {
  name = 'EmailChange1794340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PG 12+: ADD VALUE is allowed in a transaction (the value isn't used here).
    await queryRunner.query(`ALTER TYPE "public"."otp_purpose" ADD VALUE IF NOT EXISTS 'EMAIL_CHANGE'`);
    await queryRunner.query(`ALTER TABLE "users" ADD "pending_email" citext`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "pending_email"`);
    // Postgres can't drop an enum value: rebuild the type without it.
    await queryRunner.query(`DELETE FROM "user_otps" WHERE "purpose" = 'EMAIL_CHANGE'`);
    await queryRunner.query(`ALTER TYPE "public"."otp_purpose" RENAME TO "otp_purpose_old"`);
    await queryRunner.query(
      `CREATE TYPE "public"."otp_purpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'TELEGRAM_LINK')`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_otps" ALTER COLUMN "purpose" TYPE "public"."otp_purpose" USING "purpose"::text::"public"."otp_purpose"`,
    );
    await queryRunner.query(`DROP TYPE "public"."otp_purpose_old"`);
  }
}

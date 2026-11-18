import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleLogin1794329131663 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "google_id" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_google_id" UNIQUE ("google_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`,
    );
    // Every account must have at least one way to sign in
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_users_has_credential"
    CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_has_credential"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_users_google_id"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "google_id"`);
  }
}

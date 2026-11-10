import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminApproval1794162000000 implements MigrationInterface {
  name = 'AdminApproval1794162000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "roles" ("name") VALUES ('SUPER_ADMIN') ON CONFLICT ("name") DO NOTHING`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "admin_request_status" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "admin_requested_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "admin_approved_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "admin_approved_by" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "users_admin_request_status_chk" CHECK ("admin_request_status" IS NULL OR "admin_request_status" IN ('PENDING', 'APPROVED', 'REJECTED'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "users_admin_approved_by_fkey" FOREIGN KEY ("admin_approved_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "users_admin_approved_by_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "users_admin_request_status_chk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "admin_approved_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "admin_approved_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "admin_requested_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "admin_request_status"`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'ADMIN') WHERE "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'SUPER_ADMIN')`,
    );
    await queryRunner.query(
      `DELETE FROM "roles" WHERE "name" = 'SUPER_ADMIN'`,
    );
  }
}

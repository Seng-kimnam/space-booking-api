import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserRoleRelation1794161000000 implements MigrationInterface {
  name = 'UserRoleRelation1794161000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "role_id" integer`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'USER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "users_role_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."user_role"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'USER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "role" "public"."user_role"`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "role" = (SELECT "name"::"public"."user_role" FROM "roles" WHERE "roles"."id" = "users"."role_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "users_role_fkey"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role_id"`);
    await queryRunner.query(`DROP TYPE "public"."user_role"`);
  }
}

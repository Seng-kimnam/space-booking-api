import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeRoleIdToRole1794125000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM ('ADMIN', 'USER')
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "role" "user_role_enum" NOT NULL DEFAULT 'USER'
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "role_id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "role_id" smallint NOT NULL DEFAULT 2
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "role"
    `);

    await queryRunner.query(`
      DROP TYPE "user_role_enum"
    `);
  }
}
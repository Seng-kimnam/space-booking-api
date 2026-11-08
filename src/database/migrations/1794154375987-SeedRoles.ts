import { MigrationInterface, QueryRunner } from "typeorm";

export class SeedRoles1794154375987 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // ON CONFLICT makes it safe to run more than once
        await queryRunner.query(
            `INSERT INTO "roles" ("name") VALUES ('ADMIN'), ('USER') ON CONFLICT ("name") DO NOTHING`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM "roles" WHERE "name" IN ('ADMIN', 'USER')`,
        );
    }
}
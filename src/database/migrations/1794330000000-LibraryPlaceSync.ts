import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LMS place sync (docs/lms-integration-proposal.md section 4, S1-S2): ids of the
 * partner system that manages a place, its areas and its seats. All NULL for
 * places our admins manage.
 */
export class LibraryPlaceSync1794330000000 implements MigrationInterface {
  name = 'LibraryPlaceSync1794330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "places" ADD COLUMN "external_system" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "places" ADD COLUMN "external_id" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "places" ADD COLUMN "external_revision" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "places" ADD COLUMN "external_open" boolean`,
    );
    // Either the place is managed by a partner (all four set) or it isn't (all NULL).
    await queryRunner.query(
      `ALTER TABLE "places" ADD CONSTRAINT "places_external_chk" CHECK (
        ("external_system" IS NULL AND "external_id" IS NULL AND "external_revision" IS NULL AND "external_open" IS NULL)
        OR ("external_system" IS NOT NULL AND "external_id" IS NOT NULL AND "external_revision" IS NOT NULL AND "external_open" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "places" ADD CONSTRAINT "places_external_revision_chk" CHECK ("external_revision" >= 0)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "places_external_uk" ON "places" ("external_system", "external_id") WHERE "external_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "areas" ADD COLUMN "external_id" character varying(64)`,
    );
    // Soft-deleted rows keep their external_id, so a seat or area that comes back
    // in a later snapshot is restored (history kept), never duplicated.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "areas_place_external_uk" ON "areas" ("place_id", "external_id") WHERE "external_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "seats" ADD COLUMN "external_id" character varying(64)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "seats_place_external_uk" ON "seats" ("place_id", "external_id") WHERE "external_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "seats_place_external_uk"`);
    await queryRunner.query(`ALTER TABLE "seats" DROP COLUMN "external_id"`);
    await queryRunner.query(`DROP INDEX "areas_place_external_uk"`);
    await queryRunner.query(`ALTER TABLE "areas" DROP COLUMN "external_id"`);
    await queryRunner.query(`DROP INDEX "places_external_uk"`);
    await queryRunner.query(
      `ALTER TABLE "places" DROP CONSTRAINT "places_external_revision_chk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "places" DROP CONSTRAINT "places_external_chk"`,
    );
    await queryRunner.query(`ALTER TABLE "places" DROP COLUMN "external_open"`);
    await queryRunner.query(
      `ALTER TABLE "places" DROP COLUMN "external_revision"`,
    );
    await queryRunner.query(`ALTER TABLE "places" DROP COLUMN "external_id"`);
    await queryRunner.query(
      `ALTER TABLE "places" DROP COLUMN "external_system"`,
    );
  }
}

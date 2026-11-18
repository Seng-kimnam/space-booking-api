import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeatsGinAndUpdatedAt1794140000000 implements MigrationInterface {
  name = 'SeatsGinAndUpdatedAt1794140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Body copied from docs/schema/db.sql. Keeps updated_at right for raw SQL updates too.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(
      `CREATE INDEX "seats_features_gin_idx" ON "seats" USING gin ("features")`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "seats_set_updated_at" BEFORE UPDATE ON "seats" FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "seats_set_updated_at" ON "seats"`);
    await queryRunner.query(`DROP INDEX "seats_features_gin_idx"`);
    // The function is left in place on purpose: other tables will reuse it.
  }
}

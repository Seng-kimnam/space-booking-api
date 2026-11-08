import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTable1794124439891 implements MigrationInterface {
  name = 'AddUserTable1794124439891';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "users" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "name" character varying(100) NOT NULL,
    "email" character varying(255) NOT NULL,
    "password_hash" character varying(255) NOT NULL,
    "reset_token_hash" character varying(255),
    "reset_token_expires_at" TIMESTAMP WITH TIME ZONE,
    "no_show_count" integer NOT NULL DEFAULT '0',
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "role_id" smallint NOT NULL,
    "place_id" uuid,
    CONSTRAINT "UQ_users_email" UNIQUE ("email"),
    CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}

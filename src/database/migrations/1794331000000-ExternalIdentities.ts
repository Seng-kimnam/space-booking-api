import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account linking with partner systems (docs/erd.md section 10; LMS proposal
 * S14, S15): external_identities (user <-> LMS member, plus the member's
 * latest standing) and external_link_requests (one-time link codes, hash only).
 */
export class ExternalIdentities1794331000000 implements MigrationInterface {
  name = 'ExternalIdentities1794331000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "external_identities" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "external_system" character varying(30) NOT NULL,
      "external_user_id" character varying(64) NOT NULL,
      "client_id" uuid,
      "linked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "standing_eligible" boolean,
      "standing_reasons" text array NOT NULL DEFAULT '{}',
      "standing_expiry_date" date,
      "standing_evaluated_at" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "external_identities_member_uk" UNIQUE ("external_system", "external_user_id"),
      CONSTRAINT "external_identities_user_uk" UNIQUE ("external_system", "user_id"),
      CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "external_identities_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE TABLE "external_link_requests" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "external_system" character varying(30) NOT NULL,
      "external_user_id" character varying(64) NOT NULL,
      "client_id" uuid,
      "code_hash" character varying(64) NOT NULL,
      "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "used_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "external_link_requests_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "external_link_requests_code_hash_uk" UNIQUE ("code_hash"),
      CONSTRAINT "external_link_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(
      `CREATE INDEX "external_link_requests_member_idx" ON "external_link_requests" ("external_system", "external_user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "external_link_requests_member_idx"`);
    await queryRunner.query(`DROP TABLE "external_link_requests"`);
    await queryRunner.query(`DROP TABLE "external_identities"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

// Facebook sign-in stores its link in auth_identities (AGENTS.md section
// 6.13), so a Facebook-only user has neither password_hash nor google_id.
// "At least one sign-in method" spans two tables and can't be a CHECK; it is
// enforced in the service layer (docs/erd.md, users table rule).
export class SocialIdentityCredential1794350000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_has_credential"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fails if social-only (auth_identities) users exist; remove or give them
    // a password first.
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_users_has_credential"
    CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)`);
  }
}

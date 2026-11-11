import { MigrationInterface, QueryRunner } from 'typeorm';

// Data-only fix for docs/auth.md finding C1. Admin registrations used to be
// stored with the ADMIN role while waiting for approval, so a REJECTED request
// could still log in as ADMIN. Registration now stores them as USER and only
// approval grants ADMIN; this brings existing PENDING/REJECTED rows in line.
// No schema change.
export class DemoteUnapprovedAdminRequests1794163000000
  implements MigrationInterface
{
  name = 'DemoteUnapprovedAdminRequests1794163000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users"
          SET "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'USER')
        WHERE "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'ADMIN')
          AND "admin_request_status" IN ('PENDING', 'REJECTED')`,
    );
  }

  // Restores the old behaviour (unapproved requests hold the ADMIN role).
  // It also catches requests made after up(), which is what the old code
  // would have stored for them.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users"
          SET "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'ADMIN')
        WHERE "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'USER')
          AND "admin_request_status" IN ('PENDING', 'REJECTED')`,
    );
  }
}

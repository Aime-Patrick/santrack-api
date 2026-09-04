import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registration approval for self-registered businesses (Digital Tax Stamp flow).
 *
 * Adds an onboarding status so a business that signs itself up is not
 * automatically allowed to trade: it stays PENDING until a regulator approves
 * it, at which point an operating licence is issued.
 *
 * Existing organizations were all onboarded under the old rule (provisional
 * licence issued at registration), so they are backfilled as APPROVED rather
 * than left pending and suddenly locked out. Only new registrations default to
 * PENDING - the entity column default covers inserts from application code;
 * this migration's column default only shapes the pre-existing rows.
 */
export class RegistrationApproval1760500000000 implements MigrationInterface {
  name = 'RegistrationApproval1760500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "organizations_onboarding_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN "onboarding_status" "organizations_onboarding_status_enum" NOT NULL DEFAULT 'APPROVED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN "rejection_reason" varchar(500)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "rejection_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "onboarding_status"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "organizations_onboarding_status_enum"`,
    );
  }
}

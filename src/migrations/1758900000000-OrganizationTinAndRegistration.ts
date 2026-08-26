import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Business identity fields collected at registration / industry onboarding.
 *
 * TIN and company registration number were shown on the Industries form but
 * never persisted — the API only accepted name + type. These columns close
 * that gap for self-serve onboarding and the industry register alike.
 */
export class OrganizationTinAndRegistration1758900000000
  implements MigrationInterface
{
  name = 'OrganizationTinAndRegistration1758900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "tin" varchar(32) NULL,
        ADD COLUMN IF NOT EXISTS "registration_number" varchar(64) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "registration_number",
        DROP COLUMN IF EXISTS "tin"
    `);
  }
}

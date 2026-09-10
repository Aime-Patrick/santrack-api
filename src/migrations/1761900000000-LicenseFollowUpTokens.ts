import { MigrationInterface, QueryRunner } from 'typeorm';

export class LicenseFollowUpTokens1761900000000 implements MigrationInterface {
  name = 'LicenseFollowUpTokens1761900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Token used by the public response page — null until the regulator
    // chooses to send the link.
    await queryRunner.query(`
      ALTER TABLE "license_follow_ups"
        ADD COLUMN "response_token"          UUID,
        ADD COLUMN "response_token_expires_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "response_token_used"     BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_followup_response_token"
        ON "license_follow_ups" ("response_token")
        WHERE "response_token" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_followup_response_token"`);
    await queryRunner.query(`
      ALTER TABLE "license_follow_ups"
        DROP COLUMN "response_token",
        DROP COLUMN "response_token_expires_at",
        DROP COLUMN "response_token_used"
    `);
  }
}

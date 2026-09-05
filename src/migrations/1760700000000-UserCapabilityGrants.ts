import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-user capability grants (Add Industry, and later the same mechanism).
 *
 * `extra_capabilities` holds capabilities the platform operator assigned to
 * one named user on top of what their role and organization confer. The
 * default is empty; values are written only through
 * PATCH /api/users/:id/capabilities, which validates the whitelist in
 * capabilities.ts (DYNAMICALLY_GRANTABLE_CAPABILITIES).
 */
export class UserCapabilityGrants1760700000000 implements MigrationInterface {
  name = 'UserCapabilityGrants1760700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "extra_capabilities" text[] NOT NULL DEFAULT '{}'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "extra_capabilities"`,
    );
  }
}
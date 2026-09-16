import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOTP MFA for privileged accounts (system admins and regulator staff).
 * Secret is stored encrypted at the application layer (see session-cookie.ts).
 */
export class UserMfa1762300000000 implements MigrationInterface {
  name = 'UserMfa1762300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "mfa_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "mfa_secret" varchar`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_secret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_enabled"`,
    );
  }
}

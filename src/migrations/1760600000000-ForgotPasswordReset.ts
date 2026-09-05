import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Self-service password reset (forgot password).
 *
 * Adds two nullable columns to `users`: a single-use reset token (stored as
 * its SHA-256 so a leaked table cannot reset passwords) and its expiry. The
 * token is created by POST /api/auth/forgot-password, consumed once by
 * POST /api/auth/reset-password, and nulled on use or expiry.
 */
export class ForgotPasswordReset1760600000000 implements MigrationInterface {
  name = 'ForgotPasswordReset1760600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "password_reset_token" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "password_reset_expires_at" timestamptz`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "password_reset_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "password_reset_token"`,
    );
  }
}
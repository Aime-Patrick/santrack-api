import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Email changes stay on the current address until the new inbox confirms
 * via a short-lived hashed token.
 */
export class UserEmailChange1762900000000 implements MigrationInterface {
  name = 'UserEmailChange1762900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD "pending_email" character varying
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD "email_change_token" character varying
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD "email_change_expires_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_users_pending_email"
      ON "users" ("pending_email")
      WHERE "pending_email" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_pending_email"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_change_expires_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_change_token"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "pending_email"`);
  }
}

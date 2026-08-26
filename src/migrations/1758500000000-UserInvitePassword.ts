import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Invited staff may omit a display name, and accounts created with a temporary
 * password must change it before using the product.
 */
export class UserInvitePassword1758500000000 implements MigrationInterface {
  name = 'UserInvitePassword1758500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "full_name" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users" SET "full_name" = COALESCE("full_name", split_part("email", '@', 1))
      WHERE "full_name" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN "must_change_password"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "full_name" SET NOT NULL
    `);
  }
}

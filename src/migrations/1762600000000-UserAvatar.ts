import { MigrationInterface, QueryRunner } from 'typeorm';

/** Profile avatar: library URL (DiceBear) and/or uploaded storage key. */
export class UserAvatar1762600000000 implements MigrationInterface {
  name = 'UserAvatar1762600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "avatar_url" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "avatar_key" varchar`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "avatar_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "avatar_url"`,
    );
  }
}

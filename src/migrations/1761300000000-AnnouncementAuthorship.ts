import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds author-tracking columns to announcements:
 * - organization_id / organization_name — which org posted it (null = platform team)
 * - created_by_id — the user who created the record
 *
 * Also adds PUBLISH_ANNOUNCEMENT to the announcements seeded in the previous
 * migration — those were all posted by the platform, so organization_id stays NULL.
 */
export class AnnouncementAuthorship1761300000000 implements MigrationInterface {
  name = 'AnnouncementAuthorship1761300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "announcements"
        ADD COLUMN "organization_id"   INTEGER REFERENCES "organizations"("id") ON DELETE SET NULL,
        ADD COLUMN "organization_name" VARCHAR(200),
        ADD COLUMN "created_by_id"     INTEGER REFERENCES "users"("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "announcements"
        DROP COLUMN IF EXISTS "organization_id",
        DROP COLUMN IF EXISTS "organization_name",
        DROP COLUMN IF EXISTS "created_by_id"
    `);
  }
}

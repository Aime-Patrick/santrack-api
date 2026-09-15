import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mid-review "request changes" for licences (and event ledger).
 * Product registrations store status as varchar — no ALTER TYPE needed there.
 */
export class LicenseAndProductChangesRequested1762100000000
  implements MigrationInterface
{
  name = 'LicenseAndProductChangesRequested1762100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "licenses_status_enum"
        ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED'
    `);
    await queryRunner.query(`
      ALTER TYPE "licenses_status_enum"
        ADD VALUE IF NOT EXISTS 'CANCELLED'
    `);
    await queryRunner.query(`
      ALTER TYPE "license_events_type_enum"
        ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED'
    `);
    await queryRunner.query(`
      ALTER TYPE "license_events_type_enum"
        ADD VALUE IF NOT EXISTS 'CANCELLED'
    `);
    await queryRunner.query(`
      ALTER TYPE "license_events_type_enum"
        ADD VALUE IF NOT EXISTS 'FOLLOW_UP_ADDED'
    `);
    await queryRunner.query(`
      ALTER TYPE "license_events_type_enum"
        ADD VALUE IF NOT EXISTS 'FOLLOW_UP_ACTIONED'
    `);
    await queryRunner.query(`
      ALTER TYPE "license_events_type_enum"
        ADD VALUE IF NOT EXISTS 'FOLLOW_UP_CLOSED'
    `);
  }

  public async down(): Promise<void> {
    // Postgres has no ALTER TYPE … DROP VALUE.
  }
}

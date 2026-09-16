import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds SUPERSEDED so a new information request can revoke prior PENDING
 * tokens (revoke-and-reissue) instead of leaving concurrent open asks.
 */
export class InfoRequestSuperseded1762400000000 implements MigrationInterface {
  name = 'InfoRequestSuperseded1762400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."registration_info_requests_status_enum"
        ADD VALUE IF NOT EXISTS 'SUPERSEDED'
    `);
  }

  async down(): Promise<void> {
    // Postgres cannot remove enum values safely; leave SUPERSEDED in place.
  }
}

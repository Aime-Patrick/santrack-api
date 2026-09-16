import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens batches.status_reason from varchar(1000) to text so recall reasons
 * authored in the TipTap rich-text editor are stored without truncation.
 */
export class BatchStatusReasonToText1762500000000 implements MigrationInterface {
  name = 'BatchStatusReasonToText1762500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "batches"
        ALTER COLUMN "status_reason" TYPE TEXT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "batches"
        ALTER COLUMN "status_reason" TYPE VARCHAR(1000)
    `);
  }
}

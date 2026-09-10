import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens context_note and response_note in registration_consultations
 * from varchar(2000) to text so that rich-text HTML content (from the
 * Tiptap editor on the frontend) is stored without truncation.
 */
export class ConsultationNotesToText1761400000000 implements MigrationInterface {
  name = 'ConsultationNotesToText1761400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "registration_consultations"
        ALTER COLUMN "context_note"   TYPE TEXT,
        ALTER COLUMN "response_note"  TYPE TEXT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "registration_consultations"
        ALTER COLUMN "context_note"   TYPE VARCHAR(2000),
        ALTER COLUMN "response_note"  TYPE VARCHAR(2000)
    `);
  }
}

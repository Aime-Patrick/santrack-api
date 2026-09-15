import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen quality_inspections.notes from varchar(1000) to text.
 * Rich-text HTML from the Tiptap editor can exceed 1000 characters, so
 * the column must be unbounded.
 */
export class QualityInspectionNotesText1762000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quality_inspections" ALTER COLUMN "notes" TYPE text`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quality_inspections" ALTER COLUMN "notes" TYPE varchar(1000)`,
    );
  }
}

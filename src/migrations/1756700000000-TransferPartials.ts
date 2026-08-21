import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4.5: transfer discrepancies are now persisted.  A partial receipt
 * keeps the transfer open so the remaining items can be received later,
 * instead of silently stranding them as IN_TRANSIT with no resolution path.
 */
export class TransferPartials1756700000000 implements MigrationInterface {
  name = 'TransferPartials1756700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "transfers_status_enum" ADD VALUE IF NOT EXISTS 'PARTIALLY_RECEIVED'`,
    );

    await queryRunner.query(
      `ALTER TABLE "transfers" ADD COLUMN "missing_items" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transfers" DROP COLUMN IF EXISTS "missing_items"`,
    );
    // Postgres cannot remove enum values.
  }
}

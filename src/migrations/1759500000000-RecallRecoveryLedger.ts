import { MigrationInterface, QueryRunner } from 'typeorm';

/** Keeps each scan-confirmed recall outcome in the linked regulator case. */
export class RecallRecoveryLedger1759500000000 implements MigrationInterface {
  name = 'RecallRecoveryLedger1759500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'RECALL_RECOVERY_RECORDED'`);
  }

  public async down(): Promise<void> {
    // The enum value remains so historical recovery records stay truthful.
  }
}

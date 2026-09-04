import { MigrationInterface, QueryRunner } from 'typeorm';

/** System deadline events need a truthful system actor rather than a fake user. */
export class RegulatoryCaseDeadlines1759400000000 implements MigrationInterface {
  name = 'RegulatoryCaseDeadlines1759400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'DEADLINE_OVERDUE'`);
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'DEADLINE_ESCALATED'`);
    await queryRunner.query(`ALTER TABLE "regulatory_case_events" ALTER COLUMN "actor_id" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // System records cannot honestly be reassigned to a human during rollback.
    // Enum values are likewise preserved by PostgreSQL for historical safety.
    await queryRunner.query(`ALTER TABLE "regulatory_case_events" ALTER COLUMN "actor_id" SET NOT NULL`);
  }
}

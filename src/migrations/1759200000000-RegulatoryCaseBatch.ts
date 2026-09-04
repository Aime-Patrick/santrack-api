import { MigrationInterface, QueryRunner } from 'typeorm';

/** Links a recall case to the exact production lot it governs. */
export class RegulatoryCaseBatch1759200000000 implements MigrationInterface {
  name = 'RegulatoryCaseBatch1759200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "regulatory_cases" ADD COLUMN "batch_id" integer`);
    await queryRunner.query(`ALTER TABLE "regulatory_cases" ADD CONSTRAINT "FK_regulatory_cases_batch" FOREIGN KEY ("batch_id") REFERENCES "batches"("id")`);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_case_batch" ON "regulatory_cases" ("batch_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_regulatory_case_batch"`);
    await queryRunner.query(`ALTER TABLE "regulatory_cases" DROP CONSTRAINT "FK_regulatory_cases_batch"`);
    await queryRunner.query(`ALTER TABLE "regulatory_cases" DROP COLUMN "batch_id"`);
  }
}

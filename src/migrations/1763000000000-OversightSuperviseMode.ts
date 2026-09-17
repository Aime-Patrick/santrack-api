import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Oversight scopes can be OBSERVE (aggregates only) or SUPERVISE
 * (high regulator may follow up on the subordinate authority's queue).
 */
export class OversightSuperviseMode1763000000000 implements MigrationInterface {
  name = 'OversightSuperviseMode1763000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "regulatory_oversight_mode_enum" AS ENUM ('OBSERVE', 'SUPERVISE')
    `);
    await queryRunner.query(`
      ALTER TABLE "regulatory_oversight_scopes"
      ADD "mode" "regulatory_oversight_mode_enum" NOT NULL DEFAULT 'OBSERVE'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "regulatory_oversight_scopes"
      DROP COLUMN "mode"
    `);
    await queryRunner.query(`DROP TYPE "regulatory_oversight_mode_enum"`);
  }
}

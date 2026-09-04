import { MigrationInterface, QueryRunner } from 'typeorm';

/** Operational settings belong to each authority, not the platform operator. */
export class RegulatoryAuthoritySelfSetup1759900000000 implements MigrationInterface {
  name = 'RegulatoryAuthoritySelfSetup1759900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "regulatory_authorities" ADD "case_categories" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE "regulatory_authorities" ADD "teams" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "regulatory_authorities" DROP COLUMN "teams"`);
    await queryRunner.query(`ALTER TABLE "regulatory_authorities" DROP COLUMN "case_categories"`);
  }
}

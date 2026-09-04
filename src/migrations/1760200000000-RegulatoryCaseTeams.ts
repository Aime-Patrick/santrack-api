import { MigrationInterface, QueryRunner } from 'typeorm';

/** Case team names are validated against the owning authority's own configuration. */
export class RegulatoryCaseTeams1760200000000 implements MigrationInterface {
  name = 'RegulatoryCaseTeams1760200000000';
  public async up(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`ALTER TABLE "regulatory_cases" ADD "assigned_team" varchar(100)`); }
  public async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`ALTER TABLE "regulatory_cases" DROP COLUMN "assigned_team"`); }
}

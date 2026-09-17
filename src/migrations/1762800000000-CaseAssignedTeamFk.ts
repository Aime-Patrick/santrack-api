import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cases point at regulatory_teams by id so rename/deactivate no longer
 * orphans queue filters. Denormalized `assigned_team` name stays for display
 * and is backfilled from the matched row.
 */
export class CaseAssignedTeamFk1762800000000 implements MigrationInterface {
  name = 'CaseAssignedTeamFk1762800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "regulatory_cases"
      ADD "assigned_team_id" integer
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_regulatory_case_assigned_team"
      ON "regulatory_cases" ("assigned_team_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "regulatory_cases"
      ADD CONSTRAINT "FK_regulatory_cases_assigned_team"
      FOREIGN KEY ("assigned_team_id") REFERENCES "regulatory_teams"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      UPDATE "regulatory_cases" c
      SET "assigned_team_id" = t.id,
          "assigned_team" = t.name
      FROM "regulatory_teams" t
      WHERE c.lead_authority_id = t.authority_id
        AND c.assigned_team IS NOT NULL
        AND lower(trim(c.assigned_team)) = lower(trim(t.name))
        AND c.assigned_team_id IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "regulatory_cases"
      DROP CONSTRAINT "FK_regulatory_cases_assigned_team"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_regulatory_case_assigned_team"`,
    );
    await queryRunner.query(`
      ALTER TABLE "regulatory_cases"
      DROP COLUMN "assigned_team_id"
    `);
  }
}

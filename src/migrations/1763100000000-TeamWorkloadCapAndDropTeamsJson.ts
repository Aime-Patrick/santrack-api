import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-team open-case caps, and retire the legacy `regulatory_authorities.teams`
 * jsonb mirror — names now live only on `regulatory_teams`.
 */
export class TeamWorkloadCapAndDropTeamsJson1763100000000
  implements MigrationInterface
{
  name = 'TeamWorkloadCapAndDropTeamsJson1763100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "regulatory_teams"
      ADD COLUMN IF NOT EXISTS "max_open_cases" integer
    `);

    // Ensure every jsonb name still has a team row before dropping the column.
    await queryRunner.query(`
      INSERT INTO "regulatory_teams" ("authority_id", "name", "active")
      SELECT a.id, trim(t.name), true
      FROM "regulatory_authorities" a
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.teams, '[]'::jsonb)) AS t(name)
      WHERE trim(t.name) <> ''
      ON CONFLICT ("authority_id", "name") DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE "regulatory_authorities"
      DROP COLUMN IF EXISTS "teams"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "regulatory_authorities"
      ADD COLUMN IF NOT EXISTS "teams" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "regulatory_authorities" a
      SET "teams" = COALESCE((
        SELECT jsonb_agg(to_jsonb(t.name) ORDER BY t.name)
        FROM "regulatory_teams" t
        WHERE t.authority_id = a.id AND t.active = true
      ), '[]'::jsonb)
    `);
    await queryRunner.query(`
      ALTER TABLE "regulatory_teams"
      DROP COLUMN IF EXISTS "max_open_cases"
    `);
  }
}

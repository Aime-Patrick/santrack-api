import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Authority teams become first-class rows with membership and a leader flag.
 * Existing jsonb `regulatory_authorities.teams` names are backfilled; case
 * `assigned_team` strings keep matching by name.
 */
export class RegulatoryTeams1762700000000 implements MigrationInterface {
  name = 'RegulatoryTeams1762700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "regulatory_teams" (
        "id" SERIAL NOT NULL,
        "authority_id" integer NOT NULL,
        "name" character varying(100) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_regulatory_teams" PRIMARY KEY ("id"),
        CONSTRAINT "uk_regulatory_team_authority_name" UNIQUE ("authority_id", "name"),
        CONSTRAINT "FK_regulatory_teams_authority"
          FOREIGN KEY ("authority_id") REFERENCES "regulatory_authorities"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_regulatory_team_authority" ON "regulatory_teams" ("authority_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "regulatory_team_members" (
        "id" SERIAL NOT NULL,
        "team_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "is_leader" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_regulatory_team_members" PRIMARY KEY ("id"),
        CONSTRAINT "uk_regulatory_team_member" UNIQUE ("team_id", "user_id"),
        CONSTRAINT "FK_regulatory_team_members_team"
          FOREIGN KEY ("team_id") REFERENCES "regulatory_teams"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_regulatory_team_members_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_regulatory_team_member_user" ON "regulatory_team_members" ("user_id")`,
    );

    await queryRunner.query(`
      INSERT INTO "regulatory_teams" ("authority_id", "name", "active")
      SELECT a.id, trim(t.name), true
      FROM "regulatory_authorities" a
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.teams, '[]'::jsonb)) AS t(name)
      WHERE trim(t.name) <> ''
      ON CONFLICT ("authority_id", "name") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "regulatory_team_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "regulatory_teams"`);
  }
}

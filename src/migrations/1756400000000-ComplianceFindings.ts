import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The record of an organization acting outside what its licence covers
 * (technical proposal section 10, the regulator's compliance panel).
 *
 * Scoped to the organization, not to a licence: the case that matters most is
 * a business with no licence at all, which has nothing to hang off
 * license_events.
 */
export class ComplianceFindings1756400000000 implements MigrationInterface {
  name = 'ComplianceFindings1756400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "compliance_findings_type_enum" AS ENUM
        ('UNLICENSED_ACTIVITY','EXPIRED_LICENCE','SUSPENDED_LICENCE')
    `);

    await queryRunner.query(`
      CREATE TABLE "compliance_findings" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "type" "compliance_findings_type_enum" NOT NULL,
        "activity" "license_categories_activity_enum",
        "action" character varying NOT NULL,
        "license_id" integer,
        "actor_id" integer,
        "detail" character varying(1000),
        "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_finding_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_finding_license"
          FOREIGN KEY ("license_id") REFERENCES "licenses"("id"),
        CONSTRAINT "fk_finding_actor"
          FOREIGN KEY ("actor_id") REFERENCES "users"("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_finding_organization" ON "compliance_findings" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_finding_recorded" ON "compliance_findings" ("recorded_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "compliance_findings"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "compliance_findings_type_enum"`);
  }
}

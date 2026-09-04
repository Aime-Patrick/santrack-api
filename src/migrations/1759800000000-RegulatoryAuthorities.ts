import { MigrationInterface, QueryRunner } from 'typeorm';

/** Authority-first regulatory ownership; authorities are configured, never seeded in code. */
export class RegulatoryAuthorities1759800000000 implements MigrationInterface {
  name = 'RegulatoryAuthorities1759800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "regulatory_authorities" ("id" SERIAL NOT NULL, "code" varchar(32) NOT NULL, "name" varchar(180) NOT NULL, "mandates" jsonb NOT NULL DEFAULT '[]'::jsonb, "is_active" boolean NOT NULL DEFAULT true, "operating_organization_id" integer, CONSTRAINT "PK_regulatory_authorities" PRIMARY KEY ("id"), CONSTRAINT "UQ_regulatory_authorities_code" UNIQUE ("code"), CONSTRAINT "UQ_regulatory_authorities_operating_organization" UNIQUE ("operating_organization_id"), CONSTRAINT "FK_regulatory_authorities_operating_organization" FOREIGN KEY ("operating_organization_id") REFERENCES "organizations"("id"))`);
    await queryRunner.query(`ALTER TABLE "regulatory_cases" ADD "lead_authority_id" integer`);
    await queryRunner.query(`ALTER TABLE "regulatory_cases" ADD CONSTRAINT "FK_regulatory_cases_lead_authority" FOREIGN KEY ("lead_authority_id") REFERENCES "regulatory_authorities"("id")`);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_case_lead_authority" ON "regulatory_cases" ("lead_authority_id")`);
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'REFERRED'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_regulatory_case_lead_authority"`);
    await queryRunner.query(`ALTER TABLE "regulatory_cases" DROP CONSTRAINT "FK_regulatory_cases_lead_authority"`);
    await queryRunner.query(`ALTER TABLE "regulatory_cases" DROP COLUMN "lead_authority_id"`);
    await queryRunner.query(`DROP TABLE "regulatory_authorities"`);
  }
}

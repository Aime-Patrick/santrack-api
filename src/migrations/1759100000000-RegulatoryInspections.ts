import { MigrationInterface, QueryRunner } from 'typeorm';

/** Regulator field-inspection evidence, separate from a manufacturer's QC verdict. */
export class RegulatoryInspections1759100000000 implements MigrationInterface {
  name = 'RegulatoryInspections1759100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'INSPECTION_RECORDED'`);
    await queryRunner.query(`CREATE TYPE "regulatory_inspections_result_enum" AS ENUM ('PASS', 'CONDITIONAL', 'FAIL')`);
    await queryRunner.query(`
      CREATE TABLE "regulatory_inspections" (
        "id" SERIAL NOT NULL,
        "case_id" integer NOT NULL,
        "organization_id" integer NOT NULL,
        "facility_id" integer,
        "regulator_id" integer NOT NULL,
        "inspector_id" integer NOT NULL,
        "result" "regulatory_inspections_result_enum" NOT NULL,
        "notes" varchar(2000),
        "inspected_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_regulatory_inspections" PRIMARY KEY ("id"),
        CONSTRAINT "FK_regulatory_inspections_case" FOREIGN KEY ("case_id") REFERENCES "regulatory_cases"("id"),
        CONSTRAINT "FK_regulatory_inspections_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "FK_regulatory_inspections_facility" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id"),
        CONSTRAINT "FK_regulatory_inspections_regulator" FOREIGN KEY ("regulator_id") REFERENCES "organizations"("id"),
        CONSTRAINT "FK_regulatory_inspections_inspector" FOREIGN KEY ("inspector_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_inspection_case" ON "regulatory_inspections" ("case_id")`);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_inspection_organization" ON "regulatory_inspections" ("organization_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "regulatory_inspections"`);
    await queryRunner.query(`DROP TYPE "regulatory_inspections_result_enum"`);
    // PostgreSQL does not support removing a value from an enum without a
    // table rewrite. The value is harmless after rollback and preserves a
    // truthful record should an inspection event already have been written.
  }
}

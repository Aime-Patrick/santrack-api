import { MigrationInterface, QueryRunner } from 'typeorm';

/** Regulator-owned follow-up without mutating historical findings or events. */
export class RegulatoryCases1759000000000 implements MigrationInterface {
  name = 'RegulatoryCases1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "regulatory_cases_priority_enum" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')`);
    await queryRunner.query(`CREATE TYPE "regulatory_cases_status_enum" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_BUSINESS', 'ESCALATED', 'RESOLVED', 'CLOSED')`);
    await queryRunner.query(`CREATE TYPE "regulatory_case_events_type_enum" AS ENUM ('OPENED', 'ASSIGNED', 'STATUS_CHANGED', 'NOTE_ADDED')`);
    await queryRunner.query(`
      CREATE TABLE "regulatory_cases" (
        "id" SERIAL NOT NULL,
        "case_number" varchar(32),
        "organization_id" integer NOT NULL,
        "facility_id" integer,
        "license_id" integer,
        "finding_id" integer,
        "assigned_to_id" integer,
        "title" varchar(180) NOT NULL,
        "description" varchar(2000),
        "priority" "regulatory_cases_priority_enum" NOT NULL DEFAULT 'NORMAL',
        "status" "regulatory_cases_status_enum" NOT NULL DEFAULT 'OPEN',
        "due_on" date,
        "opened_by_id" integer NOT NULL,
        "opened_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_regulatory_cases" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_regulatory_cases_case_number" UNIQUE ("case_number"),
        CONSTRAINT "FK_regulatory_cases_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "FK_regulatory_cases_facility" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id"),
        CONSTRAINT "FK_regulatory_cases_license" FOREIGN KEY ("license_id") REFERENCES "licenses"("id"),
        CONSTRAINT "FK_regulatory_cases_finding" FOREIGN KEY ("finding_id") REFERENCES "compliance_findings"("id"),
        CONSTRAINT "FK_regulatory_cases_assignee" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_regulatory_cases_opened_by" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_case_status" ON "regulatory_cases" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_case_organization" ON "regulatory_cases" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_case_assignee" ON "regulatory_cases" ("assigned_to_id")`);
    await queryRunner.query(`
      CREATE TABLE "regulatory_case_events" (
        "id" SERIAL NOT NULL,
        "case_id" integer NOT NULL,
        "type" "regulatory_case_events_type_enum" NOT NULL,
        "actor_id" integer NOT NULL,
        "summary" varchar(1000) NOT NULL,
        "detail" jsonb,
        "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_regulatory_case_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_regulatory_case_events_case" FOREIGN KEY ("case_id") REFERENCES "regulatory_cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_regulatory_case_events_actor" FOREIGN KEY ("actor_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_case_event_case_recorded" ON "regulatory_case_events" ("case_id", "recorded_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "regulatory_case_events"`);
    await queryRunner.query(`DROP TABLE "regulatory_cases"`);
    await queryRunner.query(`DROP TYPE "regulatory_case_events_type_enum"`);
    await queryRunner.query(`DROP TYPE "regulatory_cases_status_enum"`);
    await queryRunner.query(`DROP TYPE "regulatory_cases_priority_enum"`);
  }
}

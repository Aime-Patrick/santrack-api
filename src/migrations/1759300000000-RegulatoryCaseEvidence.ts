import { MigrationInterface, QueryRunner } from 'typeorm';

/** Corrective-action files are records in the case ledger, not ad-hoc blobs. */
export class RegulatoryCaseEvidence1759300000000 implements MigrationInterface {
  name = 'RegulatoryCaseEvidence1759300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'EVIDENCE_SUBMITTED'`);
    await queryRunner.query(`
      CREATE TABLE "regulatory_case_evidence" (
        "id" SERIAL NOT NULL,
        "case_id" integer NOT NULL,
        "submitted_by_id" integer NOT NULL,
        "filename" varchar(255) NOT NULL,
        "content_type" varchar(120) NOT NULL,
        "size_bytes" integer NOT NULL,
        "storage_key" varchar(500) NOT NULL,
        "note" varchar(1000),
        "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_regulatory_case_evidence" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_regulatory_case_evidence_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "FK_regulatory_case_evidence_case" FOREIGN KEY ("case_id") REFERENCES "regulatory_cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_regulatory_case_evidence_submitted_by" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_case_evidence_case_submitted" ON "regulatory_case_evidence" ("case_id", "submitted_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "regulatory_case_evidence"`);
    // PostgreSQL does not safely remove enum values that may be referenced by
    // historical events, so EVIDENCE_SUBMITTED intentionally remains.
  }
}

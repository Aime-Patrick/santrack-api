import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inter-agency registration consultation system.
 *
 * Two changes:
 *
 * 1. UNDER_CONSULTATION — a new OnboardingStatus value. When the primary
 *    reviewing authority opens a consultation to another authority, the
 *    applicant's status changes to UNDER_CONSULTATION so they can see their
 *    application is being actively reviewed by multiple bodies. Returns to
 *    PENDING once all consultations resolve and the primary acts, or directly
 *    to APPROVED/REJECTED if the primary decides while consultations are open.
 *
 * 2. registration_consultations — the advisory inter-authority consultation
 *    record. One row per consultation request. The primary authority always
 *    retains ownership of the registration decision; the secondary responds
 *    with APPROVED / CONCERNS / OBJECTION. Distinct from
 *    regulatory_case_referrals which transfer case ownership on acceptance.
 */
export class RegistrationConsultation1761100000000 implements MigrationInterface {
  name = 'RegistrationConsultation1761100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. UNDER_CONSULTATION onboarding status ─────────────────────────────
    // ALTER TYPE … ADD VALUE cannot run inside a transaction.
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(`
      ALTER TYPE "organizations_onboarding_status_enum"
        ADD VALUE IF NOT EXISTS 'UNDER_CONSULTATION'
    `);
    await queryRunner.query(`BEGIN`);

    // ── 2. Consultation verdict enum ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "consultation_verdict_enum" AS ENUM (
        'APPROVED',
        'CONCERNS',
        'OBJECTION'
      )
    `);

    // ── 3. Consultation status enum ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "consultation_status_enum" AS ENUM (
        'PENDING',
        'RESPONDED',
        'CANCELLED',
        'OVERDUE'
      )
    `);

    // ── 4. registration_consultations table ─────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "registration_consultations" (
        "id"                      SERIAL PRIMARY KEY,
        "organization_id"         INTEGER NOT NULL
                                    REFERENCES "organizations"("id") ON DELETE CASCADE,
        "from_authority_id"       INTEGER NOT NULL
                                    REFERENCES "regulatory_authorities"("id"),
        "to_authority_id"         INTEGER NOT NULL
                                    REFERENCES "regulatory_authorities"("id"),
        "subject"                 VARCHAR(300) NOT NULL,
        "context_note"            VARCHAR(2000),
        "forwarded_document_ids"  INTEGER[] NOT NULL DEFAULT '{}',
        "status"                  "consultation_status_enum" NOT NULL DEFAULT 'PENDING',
        "verdict"                 "consultation_verdict_enum",
        "response_note"           VARCHAR(2000),
        "due_date"                DATE,
        "created_by_id"           INTEGER NOT NULL
                                    REFERENCES "users"("id"),
        "responded_by_id"         INTEGER
                                    REFERENCES "users"("id"),
        "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
        "responded_at"            TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_reg_consultation_org"
        ON "registration_consultations" ("organization_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_reg_consultation_to_authority_status"
        ON "registration_consultations" ("to_authority_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_reg_consultation_from_authority"
        ON "registration_consultations" ("from_authority_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "registration_consultations"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "consultation_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "consultation_verdict_enum"`,
    );
    // NOTE: PostgreSQL cannot remove an enum value without recreating the type.
    // UNDER_CONSULTATION is left in the enum on rollback; the old codebase
    // simply never writes it.
  }
}

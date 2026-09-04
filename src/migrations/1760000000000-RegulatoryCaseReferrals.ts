import { MigrationInterface, QueryRunner } from 'typeorm';

/** A referral transfers case ownership only after the receiving authority accepts. */
export class RegulatoryCaseReferrals1760000000000 implements MigrationInterface {
  name = 'RegulatoryCaseReferrals1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "regulatory_cases" ADD "case_category" varchar(100)`);
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'REFERRED'`);
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'REFERRAL_ACCEPTED'`);
    await queryRunner.query(`ALTER TYPE "regulatory_case_events_type_enum" ADD VALUE IF NOT EXISTS 'REFERRAL_REJECTED'`);
    await queryRunner.query(`CREATE TYPE "regulatory_case_referrals_status_enum" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED')`);
    await queryRunner.query(`CREATE TABLE "regulatory_case_referrals" ("id" SERIAL NOT NULL, "case_id" integer NOT NULL, "from_authority_id" integer NOT NULL, "to_authority_id" integer NOT NULL, "status" "regulatory_case_referrals_status_enum" NOT NULL DEFAULT 'PENDING', "reason" varchar(1000) NOT NULL, "referred_by_id" integer NOT NULL, "decided_by_id" integer, "decision_note" varchar(1000), "referred_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "decided_at" TIMESTAMPTZ, CONSTRAINT "PK_regulatory_case_referrals" PRIMARY KEY ("id"), CONSTRAINT "FK_regulatory_case_referrals_case" FOREIGN KEY ("case_id") REFERENCES "regulatory_cases"("id") ON DELETE CASCADE, CONSTRAINT "FK_regulatory_case_referrals_from_authority" FOREIGN KEY ("from_authority_id") REFERENCES "regulatory_authorities"("id"), CONSTRAINT "FK_regulatory_case_referrals_to_authority" FOREIGN KEY ("to_authority_id") REFERENCES "regulatory_authorities"("id"), CONSTRAINT "FK_regulatory_case_referrals_referred_by" FOREIGN KEY ("referred_by_id") REFERENCES "users"("id"), CONSTRAINT "FK_regulatory_case_referrals_decided_by" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id"))`);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_case_referral_recipient_status" ON "regulatory_case_referrals" ("to_authority_id", "status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "regulatory_case_referrals"`);
    await queryRunner.query(`DROP TYPE "regulatory_case_referrals_status_enum"`);
    await queryRunner.query(`ALTER TABLE "regulatory_cases" DROP COLUMN "case_category"`);
  }
}

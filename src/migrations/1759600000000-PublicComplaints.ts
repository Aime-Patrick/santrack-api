import { MigrationInterface, QueryRunner } from 'typeorm';

/** Anonymous market reports can create an accountable regulator case. */
export class PublicComplaints1759600000000 implements MigrationInterface {
  name = 'PublicComplaints1759600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "regulatory_cases" ALTER COLUMN "opened_by_id" DROP NOT NULL`);
    await queryRunner.query(`CREATE TYPE "public_complaints_issue_enum" AS ENUM ('SUSPECTED_COUNTERFEIT', 'ILLNESS', 'DAMAGED', 'EXPIRED', 'OTHER')`);
    await queryRunner.query(`
      CREATE TABLE "public_complaints" (
        "id" SERIAL NOT NULL, "token" varchar(256) NOT NULL, "item_id" integer, "batch_id" integer,
        "issue" "public_complaints_issue_enum" NOT NULL, "note" varchar(2000), "location_hint" varchar(180), "contact" varchar(180),
        "photo_key" varchar(500), "photo_name" varchar(255), "case_id" integer, "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_public_complaints" PRIMARY KEY ("id"),
        CONSTRAINT "FK_public_complaints_item" FOREIGN KEY ("item_id") REFERENCES "traceable_items"("id"),
        CONSTRAINT "FK_public_complaints_batch" FOREIGN KEY ("batch_id") REFERENCES "batches"("id"),
        CONSTRAINT "FK_public_complaints_case" FOREIGN KEY ("case_id") REFERENCES "regulatory_cases"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_public_complaint_received" ON "public_complaints" ("received_at")`);
    await queryRunner.query(`CREATE INDEX "idx_public_complaint_batch" ON "public_complaints" ("batch_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "public_complaints"`);
    await queryRunner.query(`DROP TYPE "public_complaints_issue_enum"`);
    // opened_by stays nullable: existing public-origin cases have no human actor.
  }
}

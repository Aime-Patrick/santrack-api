import { MigrationInterface, QueryRunner } from 'typeorm';

/** Public reports are signals awaiting regulator review, never automatic allegations. */
export class PublicComplaintTriage1759700000000 implements MigrationInterface {
  name = 'PublicComplaintTriage1759700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public_complaints_status_enum" AS ENUM ('TRIAGE', 'PROMOTED', 'DISMISSED')`);
    await queryRunner.query(`ALTER TABLE "public_complaints" ADD COLUMN "status" "public_complaints_status_enum" NOT NULL DEFAULT 'TRIAGE'`);
    await queryRunner.query(`ALTER TABLE "public_complaints" ADD COLUMN "reviewed_by_id" integer`);
    await queryRunner.query(`ALTER TABLE "public_complaints" ADD COLUMN "reviewed_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "public_complaints" ADD CONSTRAINT "FK_public_complaints_reviewed_by" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")`);
    await queryRunner.query(`CREATE INDEX "idx_public_complaint_status_received" ON "public_complaints" ("status", "received_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_public_complaint_status_received"`);
    await queryRunner.query(`ALTER TABLE "public_complaints" DROP CONSTRAINT "FK_public_complaints_reviewed_by"`);
    await queryRunner.query(`ALTER TABLE "public_complaints" DROP COLUMN "reviewed_at"`);
    await queryRunner.query(`ALTER TABLE "public_complaints" DROP COLUMN "reviewed_by_id"`);
    await queryRunner.query(`ALTER TABLE "public_complaints" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public_complaints_status_enum"`);
  }
}

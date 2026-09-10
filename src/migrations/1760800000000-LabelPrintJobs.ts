import { MigrationInterface, QueryRunner } from 'typeorm';

/** Authoritative record of a label print action (pool, template, quantity, actor). */
export class LabelPrintJobs1760800000000 implements MigrationInterface {
  name = 'LabelPrintJobs1760800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "label_print_jobs" (
        "id" SERIAL NOT NULL,
        "organization_id" integer NOT NULL,
        "pool_id" integer NOT NULL,
        "template" varchar NOT NULL,
        "quantity" integer NOT NULL,
        "rendered_count" integer NOT NULL,
        "created_by_id" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_label_print_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_label_print_jobs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "FK_label_print_jobs_pool" FOREIGN KEY ("pool_id") REFERENCES "identity_pools"("id"),
        CONSTRAINT "FK_label_print_jobs_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_print_job_org" ON "label_print_jobs" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "idx_print_job_pool" ON "label_print_jobs" ("pool_id")`);
    await queryRunner.query(`CREATE INDEX "idx_print_job_created_by" ON "label_print_jobs" ("created_by_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "label_print_jobs"`);
  }
}
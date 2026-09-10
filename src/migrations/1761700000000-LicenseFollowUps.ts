import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration creating `license_follow_ups` for post-licensing condition tracking & corrective actions.
 */
export class LicenseFollowUps1761700000000 implements MigrationInterface {
  name = 'LicenseFollowUps1761700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "license_follow_ups" (
        "id" SERIAL PRIMARY KEY,
        "license_id" integer NOT NULL,
        "title" varchar NOT NULL,
        "description" text NOT NULL,
        "priority" varchar NOT NULL DEFAULT 'MEDIUM',
        "status" varchar NOT NULL DEFAULT 'OPEN',
        "due_date" date NULL,
        "created_by_id" integer NULL,
        "business_response" text NULL,
        "evidence_attachment_key" varchar NULL,
        "evidence_filename" varchar NULL,
        "actioned_by_id" integer NULL,
        "actioned_at" timestamptz NULL,
        "closure_notes" text NULL,
        "closed_by_id" integer NULL,
        "closed_at" timestamptz NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_license_followup_license"
          FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_license_followup_creator"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_license_followup_actioner"
          FOREIGN KEY ("actioned_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_license_followup_closer"
          FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_license_followup_license" ON "license_follow_ups" ("license_id");
      CREATE INDEX IF NOT EXISTS "idx_license_followup_status" ON "license_follow_ups" ("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "license_follow_ups";`);
  }
}

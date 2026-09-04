import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrganizationOnboardingFields1760400000000 implements MigrationInterface {
  name = 'OrganizationOnboardingFields1760400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to organizations
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "email" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "phone" varchar(32)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "license_type" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "date_incorporated" date`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "description" varchar(2000)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "province" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "district" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "sector" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "cell" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "village" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN "updated_at" TIMESTAMP DEFAULT now()`);

    // Create organization_documents table
    await queryRunner.query(`
      CREATE TABLE "organization_documents" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "document_type" varchar(100) NOT NULL,
        "certificate_number" varchar(200),
        "expiry_date" date,
        "filename" varchar(255) NOT NULL,
        "content_type" varchar(120) NOT NULL,
        "size_bytes" integer NOT NULL,
        "storage_key" varchar(500) NOT NULL,
        "uploaded_at" TIMESTAMP DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_org_doc_org" ON "organization_documents" ("organization_id")`);

    // Create organization_owners table
    await queryRunner.query(`
      CREATE TABLE "organization_owners" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name" varchar(255) NOT NULL,
        "email" varchar(255),
        "phone" varchar(32),
        "percentage" decimal(5,2) NOT NULL,
        "id_number" varchar(100),
        "created_at" TIMESTAMP DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_org_owner_org" ON "organization_owners" ("organization_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_owners"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_documents"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "updated_at"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "village"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "cell"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "sector"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "district"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "province"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "description"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "date_incorporated"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "license_type"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "phone"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "email"`);
  }
}

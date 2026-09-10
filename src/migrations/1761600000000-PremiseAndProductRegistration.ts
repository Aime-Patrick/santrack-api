import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Premise Registration & Regulated Product Registration (RICA & Rwanda FDA alignment).
 *
 * 1. Enriches `facilities` with Rwandan administrative hierarchy, GPS, plot UPI, and ownership.
 * 2. Adds canonical Premise License Categories to `license_categories`.
 * 3. Adds `premise_metadata` JSONB column to `licenses` for technical personnel & premise profile snapshots.
 * 4. Creates `product_registrations`, `product_registration_documents`, and `product_registration_events`
 *    for product-level market authorization & RSB/EAC quality conformity.
 */
export class PremiseAndProductRegistration1761600000000
  implements MigrationInterface
{
  name = 'PremiseAndProductRegistration1761600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enrich facilities
    await queryRunner.query(`
      ALTER TABLE "facilities"
      ADD COLUMN IF NOT EXISTS "province" varchar NULL,
      ADD COLUMN IF NOT EXISTS "district" varchar NULL,
      ADD COLUMN IF NOT EXISTS "sector" varchar NULL,
      ADD COLUMN IF NOT EXISTS "cell" varchar NULL,
      ADD COLUMN IF NOT EXISTS "village" varchar NULL,
      ADD COLUMN IF NOT EXISTS "business_center" varchar NULL,
      ADD COLUMN IF NOT EXISTS "gps_coordinates" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "land_upi" varchar NULL,
      ADD COLUMN IF NOT EXISTS "ownership_type" varchar NULL DEFAULT 'OWNED',
      ADD COLUMN IF NOT EXISTS "lease_contract_expiry" date NULL
    `);

    // 2. Add premise_metadata to licenses
    await queryRunner.query(`
      ALTER TABLE "licenses"
      ADD COLUMN IF NOT EXISTS "premise_metadata" jsonb NULL
    `);

    // 3. Seed canonical Premise License Categories
    await queryRunner.query(`
      INSERT INTO "license_categories"
        ("code", "name", "activity", "applies_to", "required_documents", "validity_months", "active")
      VALUES
        ('MFG_FOOD_PREMISE', 'Food Manufacturing Premise Registration', 'MANUFACTURING',
         '{MANUFACTURER}',
         '{APPLICATION_LETTER,RDB_CERTIFICATE,MANAGING_DIRECTOR_ID,PAYMENT_PROOF,PLANT_LAYOUT_DRAWINGS,PROCESS_FLOWCHART,LEASE_CONTRACT,OCCUPANCY_OR_EIA_REPORT,TECHNICIAN_NOTARIZED_DEGREE,TECHNICIAN_CV,TECHNICIAN_WORK_CONTRACT,TECHNICIAN_COMMITMENT_LETTER,TECHNICIAN_ID_PASSPORT}',
         12, true),
        ('MILK_MCC', 'Milk Collection Center (MCC) Registration', 'WAREHOUSING',
         '{MANUFACTURER,WAREHOUSE,DISTRIBUTOR}',
         '{APPLICATION_LETTER,RDB_CERTIFICATE,MANAGING_DIRECTOR_ID,PAYMENT_PROOF,PLANT_LAYOUT_DRAWINGS,OCCUPANCY_OR_EIA_REPORT,TECHNICIAN_NOTARIZED_DEGREE,TECHNICIAN_CV}',
         12, true),
        ('SLAUGHTER_PREMISE', 'Slaughterhouse & Butchery Premise Registration', 'MANUFACTURING',
         '{MANUFACTURER}',
         '{APPLICATION_LETTER,RDB_CERTIFICATE,MANAGING_DIRECTOR_ID,PAYMENT_PROOF,PLANT_LAYOUT_DRAWINGS,OCCUPANCY_OR_EIA_REPORT,TECHNICIAN_NOTARIZED_DEGREE,TECHNICIAN_CV,TECHNICIAN_WORK_CONTRACT,TECHNICIAN_COMMITMENT_LETTER}',
         12, true),
        ('AGRO_PREMISE', 'Agrochemical Store & Depot Registration', 'WAREHOUSING',
         '{WAREHOUSE,DISTRIBUTOR}',
         '{APPLICATION_LETTER,RDB_CERTIFICATE,MANAGING_DIRECTOR_ID,PAYMENT_PROOF,PLANT_LAYOUT_DRAWINGS,OCCUPANCY_OR_EIA_REPORT,TECHNICIAN_NOTARIZED_DEGREE}',
         12, true)
      ON CONFLICT ("code") DO UPDATE SET
        "name" = EXCLUDED."name",
        "required_documents" = EXCLUDED."required_documents",
        "active" = true
    `);

    // 4. Create product_registrations
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_registrations" (
        "id" SERIAL PRIMARY KEY,
        "registration_number" varchar NOT NULL,
        "organization_id" integer NOT NULL,
        "facility_id" integer NULL,
        "product_id" integer NULL,
        "category_id" integer NULL,
        "product_name" varchar NOT NULL,
        "brand_name" varchar NULL,
        "intended_use" text NULL,
        "target_consumer" varchar NULL,
        "ingredients" jsonb NULL DEFAULT '[]',
        "net_contents" text[] NULL DEFAULT '{}',
        "shelf_life_months" integer NULL,
        "storage_conditions" varchar NULL,
        "rsb_standard_number" varchar NULL,
        "status" varchar NOT NULL DEFAULT 'DRAFT',
        "status_reason" varchar(1000) NULL,
        "status_changed_at" timestamptz NULL,
        "issued_by_organization_id" integer NULL,
        "reviewed_by_id" integer NULL,
        "issued_on" date NULL,
        "expires_on" date NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_prod_reg_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_prod_reg_facility"
          FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_prod_reg_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_prod_reg_category"
          FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_prod_reg_issued_by"
          FOREIGN KEY ("issued_by_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_prod_reg_reviewed_by"
          FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_registrations_number"
      ON "product_registrations" ("registration_number")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prod_reg_org"
      ON "product_registrations" ("organization_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prod_reg_facility"
      ON "product_registrations" ("facility_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prod_reg_status"
      ON "product_registrations" ("status")
    `);

    // 5. Create product_registration_documents
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_registration_documents" (
        "id" SERIAL PRIMARY KEY,
        "product_registration_id" integer NOT NULL,
        "document_type" varchar NOT NULL,
        "filename" varchar NOT NULL,
        "content_type" varchar NOT NULL,
        "size_bytes" integer NOT NULL,
        "storage_key" varchar NOT NULL,
        "uploaded_by_id" integer NULL,
        "uploaded_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_prod_reg_docs_registration"
          FOREIGN KEY ("product_registration_id")
          REFERENCES "product_registrations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_prod_reg_docs_uploaded_by"
          FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prod_reg_doc_reg"
      ON "product_registration_documents" ("product_registration_id")
    `);

    // 6. Create product_registration_events
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_registration_events" (
        "id" SERIAL PRIMARY KEY,
        "product_registration_id" integer NOT NULL,
        "type" varchar NOT NULL,
        "actor_id" integer NULL,
        "from_status" varchar NULL,
        "to_status" varchar NULL,
        "notes" varchar(1000) NULL,
        "recorded_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_prod_reg_events_registration"
          FOREIGN KEY ("product_registration_id")
          REFERENCES "product_registrations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_prod_reg_events_actor"
          FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prod_reg_event_reg"
      ON "product_registration_events" ("product_registration_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_registration_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_registration_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_registrations"`);
    await queryRunner.query(`
      DELETE FROM "license_categories"
      WHERE "code" IN ('MFG_FOOD_PREMISE', 'MILK_MCC', 'SLAUGHTER_PREMISE', 'AGRO_PREMISE')
    `);
    await queryRunner.query(`ALTER TABLE "licenses" DROP COLUMN IF EXISTS "premise_metadata"`);
    await queryRunner.query(`
      ALTER TABLE "facilities"
      DROP COLUMN IF EXISTS "province",
      DROP COLUMN IF EXISTS "district",
      DROP COLUMN IF EXISTS "sector",
      DROP COLUMN IF EXISTS "cell",
      DROP COLUMN IF EXISTS "village",
      DROP COLUMN IF EXISTS "business_center",
      DROP COLUMN IF EXISTS "gps_coordinates",
      DROP COLUMN IF EXISTS "land_upi",
      DROP COLUMN IF EXISTS "ownership_type",
      DROP COLUMN IF EXISTS "lease_contract_expiry"
    `);
  }
}

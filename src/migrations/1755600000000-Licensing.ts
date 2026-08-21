import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Industry licensing (technical proposal, section 1).
 *
 * The last statement grandfathers every organization already in the database.
 * Without it, switching licensing on would stop every existing business from
 * operating the moment this migration ran - so each one receives a provisional
 * licence with a short expiry. That is a grace period, not an exemption: it
 * lapses like any other licence, and renewing it means going through the real
 * application.
 */
export class Licensing1755600000000 implements MigrationInterface {
  name = 'Licensing1755600000000';

  /** How long grandfathered organizations have to apply properly. */
  private static readonly GRACE_DAYS = 90;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "licenses_status_enum" AS ENUM
        ('DRAFT','SUBMITTED','UNDER_REVIEW','REJECTED','ACTIVE','EXPIRED',
         'SUSPENDED','REVOKED')
    `);
    await queryRunner.query(`
      CREATE TYPE "license_categories_activity_enum" AS ENUM
        ('MANUFACTURING','WAREHOUSING','DISTRIBUTION','RETAIL','REGULATION')
    `);
    await queryRunner.query(`
      CREATE TYPE "license_events_type_enum" AS ENUM
        ('APPLIED','DOCUMENT_ATTACHED','DOCUMENT_REMOVED','SUBMITTED',
         'REVIEW_STARTED','APPROVED','REJECTED','SUSPENDED','REINSTATED',
         'REVOKED','RENEWED','EXPIRED')
    `);

    await queryRunner.query(`
      CREATE TABLE "license_categories" (
        "id" SERIAL PRIMARY KEY,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "activity" "license_categories_activity_enum" NOT NULL,
        "applies_to" "organizations_type_enum"[] NOT NULL DEFAULT '{}',
        "permitted_product_categories" text[] NOT NULL DEFAULT '{}',
        "required_documents" text[] NOT NULL DEFAULT '{}',
        "validity_months" integer NOT NULL DEFAULT 12,
        "active" boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_license_categories_code" ON "license_categories" ("code")`,
    );

    await queryRunner.query(`
      CREATE TABLE "licenses" (
        "id" SERIAL PRIMARY KEY,
        "license_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "category_id" integer NOT NULL,
        "status" "licenses_status_enum" NOT NULL DEFAULT 'DRAFT',
        "issued_by_organization_id" integer,
        "reviewed_by_id" integer,
        "issued_on" date,
        "expires_on" date,
        "status_reason" character varying(1000),
        "status_changed_at" TIMESTAMP WITH TIME ZONE,
        "previous_license_id" integer,
        "provisional" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_licenses_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_licenses_category"
          FOREIGN KEY ("category_id") REFERENCES "license_categories"("id"),
        CONSTRAINT "fk_licenses_issued_by"
          FOREIGN KEY ("issued_by_organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_licenses_reviewed_by"
          FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id"),
        CONSTRAINT "fk_licenses_previous"
          FOREIGN KEY ("previous_license_id") REFERENCES "licenses"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_licenses_number" ON "licenses" ("license_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_license_org" ON "licenses" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_license_status" ON "licenses" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "license_documents" (
        "id" SERIAL PRIMARY KEY,
        "license_id" integer NOT NULL,
        "document_type" character varying NOT NULL,
        "filename" character varying NOT NULL,
        "content_type" character varying NOT NULL,
        "size_bytes" integer NOT NULL,
        "storage_key" character varying NOT NULL,
        "uploaded_by_id" integer,
        "uploaded_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_license_documents_license"
          FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_license_documents_uploaded_by"
          FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_license_document_license" ON "license_documents" ("license_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "license_events" (
        "id" SERIAL PRIMARY KEY,
        "license_id" integer NOT NULL,
        "type" "license_events_type_enum" NOT NULL,
        "actor_id" integer,
        "from_status" "licenses_status_enum",
        "to_status" "licenses_status_enum",
        "notes" character varying(1000),
        "recorded_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_license_events_license"
          FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_license_events_actor"
          FOREIGN KEY ("actor_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_license_event_license" ON "license_events" ("license_id")`,
    );

    // ------------------------------------------------- starter categories

    await queryRunner.query(`
      INSERT INTO "license_categories"
        ("code","name","activity","applies_to","required_documents","validity_months")
      VALUES
        ('MFG','Manufacturing Licence','MANUFACTURING','{MANUFACTURER}',
         '{CERTIFICATE_OF_INCORPORATION,TAX_CLEARANCE,PREMISES_INSPECTION}', 12),
        ('WHS','Warehousing Licence','WAREHOUSING','{WAREHOUSE,DISTRIBUTOR}',
         '{CERTIFICATE_OF_INCORPORATION,PREMISES_INSPECTION}', 24),
        ('DST','Distribution Licence','DISTRIBUTION','{DISTRIBUTOR,WAREHOUSE}',
         '{CERTIFICATE_OF_INCORPORATION,TAX_CLEARANCE}', 24),
        ('RTL','Retail Licence','RETAIL','{RETAILER,SHOP}',
         '{CERTIFICATE_OF_INCORPORATION}', 24),
        ('REG','Regulatory Authority','REGULATION','{REGULATOR}',
         '{GOVERNMENT_MANDATE}', 60)
    `);

    // ---------------------------------------------------- grandfathering

    await queryRunner.query(`
      INSERT INTO "licenses" (
        "license_number","organization_id","category_id","status",
        "issued_on","expires_on","status_reason","status_changed_at","provisional")
      SELECT
        'LIC-' || c.code || '-P' || lpad(o.id::text, 5, '0'),
        o.id,
        c.id,
        'ACTIVE',
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '${Licensing1755600000000.GRACE_DAYS} days',
        'Provisional licence issued automatically when licensing was introduced. Apply for a full licence before it expires.',
        now(),
        true
      FROM "organizations" o
      JOIN "license_categories" c
        ON o.type = ANY (c.applies_to)
      WHERE NOT EXISTS (
        SELECT 1 FROM "licenses" l WHERE l.organization_id = o.id
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "license_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "license_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "licenses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "license_categories"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "license_events_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "license_categories_activity_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "licenses_status_enum"`);
  }
}

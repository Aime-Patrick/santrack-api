import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the announcements table powering the public /updates page.
 * Announcements are authored by platform admins and read publicly
 * without authentication.
 */
export class Announcements1761200000000 implements MigrationInterface {
  name = 'Announcements1761200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "announcement_category_enum" AS ENUM (
        'RELEASE',
        'REGULATORY',
        'INDUSTRY_NEWS',
        'STANDARD'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "announcements" (
        "id"           SERIAL PRIMARY KEY,
        "title"        VARCHAR(300) NOT NULL,
        "excerpt"      VARCHAR(1000) NOT NULL,
        "body"         TEXT,
        "category"     "announcement_category_enum" NOT NULL DEFAULT 'RELEASE',
        "author"       VARCHAR(150) NOT NULL,
        "read_time"    VARCHAR(30),
        "slug"         VARCHAR(200) NOT NULL UNIQUE,
        "published"    BOOLEAN NOT NULL DEFAULT FALSE,
        "published_at" TIMESTAMPTZ,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_announcements_published" ON "announcements" ("published", "published_at" DESC)`,
    );

    /* Seed the five posts that were previously hardcoded in the frontend. */
    await queryRunner.query(`
      INSERT INTO "announcements"
        ("title", "excerpt", "category", "author", "read_time", "slug", "published", "published_at")
      VALUES
        (
          'GS1 Digital Link 2D Barcode Serialization Standards Live in Rwanda',
          'SANTRACK rolls out official GS1 Digital Link compliant QR serialization, enabling products to be read by both standard retail POS supermarket tills and consumer smartphones.',
          'STANDARD', 'SANTRACK Engineering', '3 min read',
          'gs1-digital-link-rollout', TRUE, '2026-08-20'
        ),
        (
          'Rwanda FDA & RSB Real-Time Compliance Audit Integration',
          'Regulators can now conduct instant digital audits of manufacturing batches, expiration timelines, and raw material provenance without requesting paper records.',
          'REGULATORY', 'Compliance Directorate', '4 min read',
          'fda-audit-integration', TRUE, '2026-08-14'
        ),
        (
          'Anti-Counterfeiting Mobile Scanner Upgrade for Consumer Protection',
          'The public verification engine now supports high-speed camera scanning with instant cryptographic token verification and duplicate scan clone detection.',
          'RELEASE', 'Product Team', '2 min read',
          'mobile-consumer-scanner', TRUE, '2026-08-08'
        ),
        (
          'Opening Stock Adoption: Fast-Track Inventory Onboarding for Distributors',
          'Wholesalers and distributors can now onboard legacy GS1 barcodes and existing physical inventory directly in bulk mode with high-throughput scanner support.',
          'RELEASE', 'Supply Chain Solutions', '3 min read',
          'opening-stock-fast-track', TRUE, '2026-07-28'
        ),
        (
          'Targeted Batch Recall Protocol Activated for Food & Beverage Plants',
          'New protocol allows factories to execute single-lot quarantine across the entire retail network in under 60 seconds, preventing mass destruction of unaffected batches.',
          'INDUSTRY_NEWS', 'Standards Advisory', '5 min read',
          'cold-chain-batch-recalls', TRUE, '2026-07-15'
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "announcements"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "announcement_category_enum"`);
  }
}

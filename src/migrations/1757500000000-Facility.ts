import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces the operational site (DR-02).
 *
 * Production referenced a machine but never a place, and machines had no
 * location, so "which plant made this batch?" - the first question in a recall -
 * had no answer. `Location` could not stand in: it models where stock sits, and
 * a bay is not a site.
 *
 * Additive. Every new column is nullable, every existing relationship is
 * untouched, and the backfill gives each organization exactly one facility so
 * historic production and batches remain answerable by site rather than being
 * left blank.
 */
export class Facility1757500000000 implements MigrationInterface {
  name = 'Facility1757500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "facilities" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" int NOT NULL REFERENCES "organizations"("id"),
        "name" varchar NOT NULL,
        "code" varchar NULL,
        "address" varchar NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_facility_org" ON "facilities" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_facility_code" ON "facilities" ("code") WHERE "code" IS NOT NULL`,
    );

    /**
     * One facility per existing organization, deterministically named after it.
     *
     * Every organization today effectively runs a single site, so this states
     * something true rather than inventing structure. Splitting a real
     * multi-plant business into its actual sites is a decision only that
     * business can make, and it can do so afterwards.
     */
    await queryRunner.query(`
      INSERT INTO "facilities" ("organization_id", "name", "code")
      SELECT
        o."id",
        o."name" || ' — main site',
        'FAC-' || LPAD(ROW_NUMBER() OVER (ORDER BY o."id")::text, 6, '0')
      FROM "organizations" o
    `);

    await queryRunner.query(`
      INSERT INTO "code_sequences" ("prefix", "next_value")
      VALUES ('FAC', (SELECT COUNT(*) + 1 FROM "facilities"))
      ON CONFLICT ("prefix") DO UPDATE
      SET "next_value" = GREATEST(
        "code_sequences"."next_value",
        (SELECT COUNT(*) + 1 FROM "facilities")
      )
    `);

    // Nullable everywhere: a shop with no plant should not be forced to invent
    // one, and nothing existing is required to have been produced at a site.
    for (const table of ['locations', 'machines', 'production_orders', 'batches']) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD COLUMN "facility_id" int NULL REFERENCES "facilities"("id")
      `);
      await queryRunner.query(
        `CREATE INDEX "idx_${table}_facility" ON "${table}" ("facility_id")`,
      );
    }

    /**
     * Point historic records at their organization's backfilled facility, so
     * the recall question is answerable for data that already exists.
     *
     * Locations and machines key off the organization they belong to. Batches
     * take the facility of the production order that made them where there is
     * one, and otherwise their manufacturer's - a lot created directly through
     * the catalogue path has no order to inherit from.
     */
    await queryRunner.query(`
      UPDATE "locations" l SET "facility_id" = f."id"
      FROM "facilities" f WHERE f."organization_id" = l."organization_id"
    `);
    await queryRunner.query(`
      UPDATE "machines" m SET "facility_id" = f."id"
      FROM "facilities" f WHERE f."organization_id" = m."organization_id"
    `);
    await queryRunner.query(`
      UPDATE "production_orders" po SET "facility_id" = f."id"
      FROM "facilities" f WHERE f."organization_id" = po."organization_id"
    `);
    await queryRunner.query(`
      UPDATE "batches" b SET "facility_id" = po."facility_id"
      FROM "production_orders" po WHERE po."batch_id" = b."id"
    `);
    await queryRunner.query(`
      UPDATE "batches" b SET "facility_id" = f."id"
      FROM "facilities" f
      WHERE b."facility_id" IS NULL AND f."organization_id" = b."manufacturer_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['batches', 'production_orders', 'machines', 'locations']) {
      await queryRunner.query(`DROP INDEX "idx_${table}_facility"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "facility_id"`);
    }
    await queryRunner.query(`DROP INDEX "idx_facility_code"`);
    await queryRunner.query(`DROP INDEX "idx_facility_org"`);
    await queryRunner.query(`DROP TABLE "facilities"`);
    await queryRunner.query(`DELETE FROM "code_sequences" WHERE "prefix" = 'FAC'`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restores the "every organization has a site" invariant (DR-02).
 *
 * The Facility migration gave a site to every organization that existed when it
 * ran, but `OrganizationService.create` was not yet giving one to organizations
 * created afterwards. That defect is fixed in application code; this closes the
 * window it was open for.
 *
 * Idempotent by construction: it inserts only where no facility exists, so
 * running it twice is a no-op and it is safe on a database that never had the
 * gap — including a fresh one, where it inserts nothing at all.
 *
 * Deliberately not a delete. The affected rows are ordinary organizations that
 * happen to be missing a related record; the fix is to supply what is missing,
 * not to remove data because of when it was created.
 */
export class BackfillMissingFacilities1757700000000 implements MigrationInterface {
  name = 'BackfillMissingFacilities1757700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Numbered from wherever the shared counter has reached, so these codes
    // cannot collide with any already issued or with the next one minted.
    await queryRunner.query(`
      INSERT INTO "facilities" ("organization_id", "name", "code")
      SELECT
        o."id",
        o."name" || ' — main site',
        'FAC-' || LPAD(
          (
            COALESCE((SELECT MAX("next_value")::bigint FROM "code_sequences" WHERE "prefix" = 'FAC'), 1)
            + ROW_NUMBER() OVER (ORDER BY o."id") - 1
          )::text,
          6, '0'
        )
      FROM "organizations" o
      WHERE NOT EXISTS (
        SELECT 1 FROM "facilities" f WHERE f."organization_id" = o."id"
      )
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

    /**
     * Historic records belonging to those organizations pick up the new site,
     * so the recall question stays answerable for everything they made. Only
     * rows with no facility are touched — anything already attributed keeps
     * what it has.
     */
    for (const [table, fk] of [
      ['locations', 'organization_id'],
      ['machines', 'organization_id'],
      ['production_orders', 'organization_id'],
    ] as const) {
      await queryRunner.query(`
        UPDATE "${table}" t SET "facility_id" = f."id"
        FROM "facilities" f
        WHERE t."facility_id" IS NULL AND f."organization_id" = t."${fk}"
      `);
    }

    await queryRunner.query(`
      UPDATE "batches" b SET "facility_id" = po."facility_id"
      FROM "production_orders" po
      WHERE b."facility_id" IS NULL AND po."batch_id" = b."id"
        AND po."facility_id" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "batches" b SET "facility_id" = f."id"
      FROM "facilities" f
      WHERE b."facility_id" IS NULL AND f."organization_id" = b."manufacturer_id"
    `);
  }

  /**
   * Deliberately empty.
   *
   * There is no record of which facilities this created rather than the
   * original backfill, and guessing would delete sites that production and
   * batches now reference. Reverting the Facility migration itself removes them
   * all, which is the only safe way back.
   */
  public async down(): Promise<void> {
    // Intentionally no-op — see above.
  }
}

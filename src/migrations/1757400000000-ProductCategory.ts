import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns the free-text product category into a governed taxonomy (DR-05).
 *
 * `Product.category` was a nullable string written by whoever filled in the
 * form. At the time of writing the database held `DAIRY`, `Books`, one empty
 * string and 76 nulls - already two casing conventions across two values, and
 * nothing to stop a third. Regulatory requirements will attach to categories,
 * and a rule cannot attach to uncontrolled text.
 *
 * Additive throughout. The legacy `category` column is kept, untouched, as the
 * record of what was originally typed; it is dropped only under separate
 * approval once nothing writes to it.
 */
export class ProductCategory1757400000000 implements MigrationInterface {
  name = 'ProductCategory1757400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_categories" (
        "id" SERIAL PRIMARY KEY,
        "code" varchar NOT NULL,
        "name" varchar NOT NULL,
        "parent_id" int NULL REFERENCES "product_categories"("id"),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_product_category_code" ON "product_categories" ("code")
    `);

    // Only the categories the data actually contains. No UNCATEGORISED bucket:
    // 76 products genuinely have no category, and inventing one for them would
    // be a false classification that later rules could attach to.
    await queryRunner.query(`
      INSERT INTO "product_categories" ("code", "name") VALUES
        ('DAIRY', 'Dairy'),
        ('BOOKS', 'Books')
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN "category_id" int NULL REFERENCES "product_categories"("id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_product_category" ON "products" ("category_id")
    `);

    /**
     * Deterministic backfill: normalise case and whitespace, then match on code.
     * An empty string is not a category - it becomes null, which is what it
     * always meant. Anything that does not match a seeded code is left null and
     * keeps its legacy string, so no product is silently mis-filed.
     */
    await queryRunner.query(`
      UPDATE "products" p
      SET "category_id" = c."id"
      FROM "product_categories" c
      WHERE c."code" = UPPER(TRIM(p."category"))
        AND TRIM(COALESCE(p."category", '')) <> ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_category"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "category_id"`);
    await queryRunner.query(`DROP INDEX "idx_product_category_code"`);
    await queryRunner.query(`DROP TABLE "product_categories"`);
  }
}

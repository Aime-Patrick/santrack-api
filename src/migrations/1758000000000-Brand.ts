import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns the free-text product brand into a record the business owns.
 *
 * `Product.brand` was a nullable string typed into the form per product, which
 * meant "Mützig" and "Mutzig" were two brands, and a manufacturer with a dozen
 * marks re-typed each of them on every product. Bralirwa alone carries
 * fourteen — Primus, Mützig, Legend, Amstel Malt, Turbo King and Heineken from
 * its own brewery, plus Coca-Cola, Sprite, Stoney, Krest Tonic and four Fantas
 * under licence.
 *
 * Scoped to the organization rather than to a category, because that same list
 * spans two categories: Primus is beer, Fanta Orange is a soft drink, one
 * manufacturer. Filed under a category, Bralirwa's brands would split into
 * unrelated halves and a brand entering a new category would become a second
 * record sharing nothing with the first. Which brands appear under a category
 * is derived from the products, where both facts already sit.
 *
 * `organization_id` is not a claim of legal ownership: Bralirwa produces Fanta
 * under licence from The Coca-Cola Company, and Heineken belongs to its parent.
 * It records which business may file products under the mark here, which is the
 * only question this platform is entitled to answer.
 *
 * Additive. The legacy `brand` column is kept, untouched, as the record of what
 * was originally typed — the same treatment `category` got when `category_id`
 * arrived — and is dropped only under separate approval once nothing writes it.
 */
export class Brand1758000000000 implements MigrationInterface {
  name = 'Brand1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "brands" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" int NOT NULL REFERENCES "organizations"("id"),
        "code" varchar NOT NULL,
        "name" varchar NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // Unique per organization, not globally: two businesses may legitimately
    // register the same word, and one getting there first must not stop the
    // other trading. The code is derived from the name, so uniqueness on it is
    // what actually prevents "Mützig" and "Mutzig" coexisting in one list.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_brand_org_code" ON "brands" ("organization_id", "code")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_brand_org" ON "brands" ("organization_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "products" ADD COLUMN "brand_id" int NULL REFERENCES "brands"("id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_product_brand" ON "products" ("brand_id")
    `);

    /**
     * Every distinct brand already typed becomes a real one, per organization.
     *
     * Trimmed and case-folded into a code the same way the API derives one, so
     * a business that wrote "Akagera" on one product and "AKAGERA" on another
     * ends with a single brand rather than two. The name kept is the first
     * spelling recorded; whoever owns it can rename it afterwards.
     */
    await queryRunner.query(`
      INSERT INTO "brands" ("organization_id", "code", "name")
      SELECT
        p."organization_id",
        upper(regexp_replace(btrim(p."brand"), '[^A-Za-z0-9-]+', '_', 'g')),
        min(btrim(p."brand"))
      FROM "products" p
      WHERE p."brand" IS NOT NULL AND btrim(p."brand") <> ''
      GROUP BY p."organization_id",
               upper(regexp_replace(btrim(p."brand"), '[^A-Za-z0-9-]+', '_', 'g'))
    `);

    await queryRunner.query(`
      UPDATE "products" p
      SET "brand_id" = b."id"
      FROM "brands" b
      WHERE b."organization_id" = p."organization_id"
        AND b."code" = upper(regexp_replace(btrim(p."brand"), '[^A-Za-z0-9-]+', '_', 'g'))
        AND p."brand" IS NOT NULL
        AND btrim(p."brand") <> ''
    `);
  }

  /**
   * Drops the link and the table. The legacy `brand` text was never modified,
   * so every product still says what it always said — nothing typed is lost by
   * reversing this.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_brand"`);
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "brand_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_brand_org"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_brand_org_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "brands"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GTIN identifies one trade item per manufacturer catalogue — not one row
 * across the whole platform. Distributors and retailers also need to store the
 * same manufacturer barcode so inbound scans recognise the product.
 */
export class ProductGtinPerOrganization1762200000000
  implements MigrationInterface
{
  name = 'ProductGtinPerOrganization1762200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_gtin"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_product_org_gtin"
      ON "products" ("organization_id", "gtin")
      WHERE "gtin" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_org_gtin"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_product_gtin"
      ON "products" ("gtin")
      WHERE "gtin" IS NOT NULL
    `);
  }
}

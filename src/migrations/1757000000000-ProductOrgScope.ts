import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductOrgScope1757000000000 implements MigrationInterface {
  name = 'ProductOrgScope1757000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add organization_id column — default to 1 for existing rows
    // (assumes single-org seed data; real migrations would need data review)
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN "organization_id" integer NOT NULL DEFAULT 1
    `);

    // Drop the old global unique index on SKU (it's now unique per org)
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_product_sku"
    `);

    // Create composite unique index: SKU is unique within an organization
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_product_org_sku"
      ON "products" ("organization_id", "sku")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_org_sku"`);
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN "organization_id"
    `);

    // Restore original global unique SKU index
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_product_sku"
      ON "products" ("sku")
    `);
  }
}

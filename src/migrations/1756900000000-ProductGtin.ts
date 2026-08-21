import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductGtin1756900000000 implements MigrationInterface {
  name = 'ProductGtin1756900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN "gtin" varchar
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_product_gtin"
      ON "products" ("gtin")
      WHERE "gtin" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_gtin"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "gtin"`);
  }
}

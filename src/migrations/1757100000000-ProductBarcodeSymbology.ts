import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which code type each product's label prints by default.
 *
 * Deliberately a plain varchar rather than a Postgres enum: the symbology
 * catalogue is application knowledge that will grow as new packaging levels
 * need new code types, and every addition to a database enum is another
 * migration and another lock on a live table for no gain. The application
 * validates against the catalogue on the way in.
 *
 * Null means QR, which is what every existing product has been labelling as,
 * so there is nothing to backfill.
 */
export class ProductBarcodeSymbology1757100000000 implements MigrationInterface {
  name = 'ProductBarcodeSymbology1757100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN "barcode_symbology" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN "barcode_symbology"
    `);
  }
}

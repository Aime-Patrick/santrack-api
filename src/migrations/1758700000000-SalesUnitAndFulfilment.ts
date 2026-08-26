import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DR-09 WU-4 / M2 — sales unit + requested vs fulfilment quantities.
 *
 * Renames the commercial line `quantity` to `requested_quantity` so the
 * customer's ask is never overwritten by warehouse rounding. Adds `sales_unit`
 * (nullable; historic rows stay null and read as bare product units). Order
 * lines gain `fulfilment_quantity` (backfilled to requested). Rounding
 * acceptance is recorded on the order header before confirm.
 */
export class SalesUnitAndFulfilment1758700000000 implements MigrationInterface {
  name = 'SalesUnitAndFulfilment1758700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "quotation_lines"
      RENAME COLUMN "quantity" TO "requested_quantity"
    `);
    await queryRunner.query(`
      ALTER TABLE "quotation_lines"
      ADD COLUMN "sales_unit" varchar NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "sales_order_lines"
      RENAME COLUMN "quantity" TO "requested_quantity"
    `);
    await queryRunner.query(`
      ALTER TABLE "sales_order_lines"
      ADD COLUMN "sales_unit" varchar NULL,
      ADD COLUMN "fulfilment_quantity" numeric(14,3) NULL
    `);
    await queryRunner.query(`
      UPDATE "sales_order_lines"
      SET "fulfilment_quantity" = "requested_quantity"
      WHERE "fulfilment_quantity" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "sales_orders"
      ADD COLUMN "rounding_accepted_at" TIMESTAMPTZ NULL,
      ADD COLUMN "rounding_accepted_by_id" integer NULL
        REFERENCES "users"("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sales_orders"
      DROP COLUMN "rounding_accepted_by_id",
      DROP COLUMN "rounding_accepted_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "sales_order_lines"
      DROP COLUMN "fulfilment_quantity",
      DROP COLUMN "sales_unit"
    `);
    await queryRunner.query(`
      ALTER TABLE "sales_order_lines"
      RENAME COLUMN "requested_quantity" TO "quantity"
    `);

    await queryRunner.query(`
      ALTER TABLE "quotation_lines"
      DROP COLUMN "sales_unit"
    `);
    await queryRunner.query(`
      ALTER TABLE "quotation_lines"
      RENAME COLUMN "requested_quantity" TO "quantity"
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4: closes the gap between the commercial paper trail and physical
 * stock. Adds the RESERVED status so orders can hold inventory, the
 * reservation table that ties specific identities to order lines, and the
 * DELIVERED event for proof-of-delivery.
 */
export class Phase4CommerceStock1756600000000 implements MigrationInterface {
  name = 'Phase4CommerceStock1756600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- vocabularies ---------------------------------------------------

    await queryRunner.query(
      `ALTER TYPE "traceability_events_type_enum" ADD VALUE IF NOT EXISTS 'RESERVED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "traceability_events_type_enum" ADD VALUE IF NOT EXISTS 'DELIVERED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "traceable_items_status_enum" ADD VALUE IF NOT EXISTS 'RESERVED'`,
    );

    // --- sales order reservations ---------------------------------------
    // Ties specific product identities to order lines so that confirm() can
    // hold stock (FEFO) and fulfil() knows exactly what to dispatch.

    await queryRunner.query(`
      CREATE TABLE "sales_order_reservations" (
        "id" SERIAL PRIMARY KEY,
        "order_id" integer NOT NULL,
        "order_line_id" integer NOT NULL,
        "item_id" integer NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "reserved_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_reservation_order"
          FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_reservation_line"
          FOREIGN KEY ("order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_reservation_item"
          FOREIGN KEY ("item_id") REFERENCES "traceable_items"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_reservation_order" ON "sales_order_reservations" ("order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_reservation_item" ON "sales_order_reservations" ("item_id")`,
    );

    // --- sales_order: link to transfer once dispatched -------------------

    await queryRunner.query(
      `ALTER TABLE "sales_orders" ADD COLUMN "transfer_id" integer`,
    );
    await queryRunner.query(`
      ALTER TABLE "sales_orders"
        ADD CONSTRAINT "fk_order_transfer"
        FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "fk_order_transfer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_orders" DROP COLUMN IF EXISTS "transfer_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_order_reservations"`);
    // Postgres cannot remove enum values; they stay inert.
  }
}

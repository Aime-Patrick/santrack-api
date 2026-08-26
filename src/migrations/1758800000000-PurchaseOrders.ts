import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Purchase orders for finished-goods inbound (DR-10): org-scoped supplier
 * directory and buyer POs. Commercial paper only in v1 — physical stock still
 * moves through Transfer receive.
 */
export class PurchaseOrders1758800000000 implements MigrationInterface {
  name = 'PurchaseOrders1758800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "purchase_orders_status_enum" AS ENUM
        ('DRAFT','SENT','CONFIRMED','RECEIVING','CLOSED','CANCELLED')
    `);

    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "linked_organization_id" integer,
        "contact" character varying,
        "phone" character varying,
        "email" character varying,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_supplier_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_suppliers_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_suppliers_linked_organization"
          FOREIGN KEY ("linked_organization_id") REFERENCES "organizations"("id")
            ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_org" ON "suppliers" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_linked_organization"
         ON "suppliers" ("linked_organization_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "purchase_orders" (
        "id" SERIAL PRIMARY KEY,
        "po_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "supplier_id" integer NOT NULL,
        "status" "purchase_orders_status_enum" NOT NULL DEFAULT 'DRAFT',
        "expected_on" date,
        "subtotal" numeric(14,2),
        "tax_percent" numeric(5,2),
        "total_amount" numeric(14,2),
        "notes" character varying(1000),
        "created_by_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_po_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_po_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id"),
        CONSTRAINT "fk_po_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_purchase_orders_number" ON "purchase_orders" ("po_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_po_org" ON "purchase_orders" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_po_supplier" ON "purchase_orders" ("supplier_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "purchase_order_lines" (
        "id" SERIAL PRIMARY KEY,
        "purchase_order_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "description" character varying,
        "quantity" numeric(14,3) NOT NULL,
        "unit_price" numeric(14,2) NOT NULL,
        "line_total" numeric(14,2),
        "received_quantity" numeric(14,3) NOT NULL DEFAULT 0,
        CONSTRAINT "fk_po_line_order"
          FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
            ON DELETE CASCADE,
        CONSTRAINT "fk_po_line_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_po_line_order"
         ON "purchase_order_lines" ("purchase_order_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "purchase_order_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "purchase_orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "suppliers"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "purchase_orders_status_enum"`);
  }
}

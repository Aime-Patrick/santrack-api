import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sales & client management (technical proposal section 6): customer
 * registration and segmentation, quotations, sales orders, invoices,
 * payments, credit ceilings, customer statements and returns with refunds.
 *
 * This is the commercial layer. Physical stock still moves through the item,
 * transfer and sale modules - these documents are the paper trail of who
 * bought what and what they still owe.
 */
export class Commerce1755900000000 implements MigrationInterface {
  name = 'Commerce1755900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- enums

    await queryRunner.query(`
      CREATE TYPE "customers_type_enum" AS ENUM ('BUSINESS','CONSUMER')
    `);
    await queryRunner.query(`
      CREATE TYPE "customers_segment_enum" AS ENUM
        ('RETAIL','WHOLESALE','PREMIUM','KEY_ACCOUNT')
    `);
    await queryRunner.query(`
      CREATE TYPE "quotations_status_enum" AS ENUM
        ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED')
    `);
    await queryRunner.query(`
      CREATE TYPE "sales_orders_status_enum" AS ENUM
        ('PLACED','CONFIRMED','FULFILLED','CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE "invoices_status_enum" AS ENUM
        ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','VOID')
    `);
    await queryRunner.query(`
      CREATE TYPE "payments_method_enum" AS ENUM
        ('CASH','BANK_TRANSFER','MOBILE_MONEY','CHEQUE','CARD')
    `);
    await queryRunner.query(`
      CREATE TYPE "sales_returns_status_enum" AS ENUM
        ('REQUESTED','APPROVED','REFUNDED','REJECTED')
    `);

    // ---------------------------------------------------------- customers

    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "type" "customers_type_enum" NOT NULL,
        "segment" "customers_segment_enum" NOT NULL DEFAULT 'RETAIL',
        "contact_person" character varying,
        "phone" character varying,
        "email" character varying,
        "address" character varying,
        "credit_limit" numeric(14,2),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_customer_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_customers_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_customer_org" ON "customers" ("organization_id")`,
    );

    // -------------------------------------------------------- quotations

    await queryRunner.query(`
      CREATE TABLE "quotations" (
        "id" SERIAL PRIMARY KEY,
        "quotation_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "status" "quotations_status_enum" NOT NULL DEFAULT 'DRAFT',
        "valid_until_on" date,
        "subtotal" numeric(14,2),
        "tax_percent" numeric(5,2),
        "total_amount" numeric(14,2),
        "notes" character varying(1000),
        "created_by_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_quotations_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_quotations_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
        CONSTRAINT "fk_quotations_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_quotations_number" ON "quotations" ("quotation_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_quotation_org" ON "quotations" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_quotation_customer" ON "quotations" ("customer_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "quotation_lines" (
        "id" SERIAL PRIMARY KEY,
        "quotation_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "description" character varying,
        "quantity" numeric(14,3) NOT NULL,
        "unit_price" numeric(14,2) NOT NULL,
        "line_total" numeric(14,2),
        CONSTRAINT "fk_quotation_line_quotation"
          FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_quotation_line_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_quotation_line_quotation"
        ON "quotation_lines" ("quotation_id")`,
    );

    // ------------------------------------------------------- sales orders

    await queryRunner.query(`
      CREATE TABLE "sales_orders" (
        "id" SERIAL PRIMARY KEY,
        "order_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "quotation_id" integer,
        "status" "sales_orders_status_enum" NOT NULL DEFAULT 'PLACED',
        "requested_delivery_on" date,
        "subtotal" numeric(14,2),
        "tax_percent" numeric(5,2),
        "total_amount" numeric(14,2),
        "notes" character varying(1000),
        "created_by_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_orders_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_orders_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
        CONSTRAINT "fk_orders_quotation"
          FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id"),
        CONSTRAINT "fk_orders_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_orders_number" ON "sales_orders" ("order_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_order_org" ON "sales_orders" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_order_customer" ON "sales_orders" ("customer_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "sales_order_lines" (
        "id" SERIAL PRIMARY KEY,
        "order_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "description" character varying,
        "quantity" numeric(14,3) NOT NULL,
        "unit_price" numeric(14,2) NOT NULL,
        "line_total" numeric(14,2),
        CONSTRAINT "fk_order_line_order"
          FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_order_line_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_order_line_order" ON "sales_order_lines" ("order_id")`,
    );

    // ----------------------------------------------------------- invoices

    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id" SERIAL PRIMARY KEY,
        "invoice_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "sales_order_id" integer,
        "status" "invoices_status_enum" NOT NULL DEFAULT 'DRAFT',
        "issued_on" date,
        "due_on" date,
        "subtotal" numeric(14,2),
        "tax_percent" numeric(5,2),
        "total_amount" numeric(14,2),
        "amount_paid" numeric(14,2) NOT NULL DEFAULT 0,
        "notes" character varying(1000),
        "created_by_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_invoices_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_invoices_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
        CONSTRAINT "fk_invoices_order"
          FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id"),
        CONSTRAINT "fk_invoices_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoices_number" ON "invoices" ("invoice_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoice_org" ON "invoices" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoice_customer" ON "invoices" ("customer_id")`,
    );

    // ----------------------------------------------------------- payments

    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" SERIAL PRIMARY KEY,
        "payment_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "invoice_id" integer NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "method" "payments_method_enum" NOT NULL,
        "reference" character varying,
        "received_by_id" integer,
        "paid_on" date,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_payments_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_payments_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
        CONSTRAINT "fk_payments_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id"),
        CONSTRAINT "fk_payments_received_by"
          FOREIGN KEY ("received_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payments_number" ON "payments" ("payment_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_org" ON "payments" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_customer" ON "payments" ("customer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_invoice" ON "payments" ("invoice_id")`,
    );

    // --------------------------------------------------- returns & refunds

    await queryRunner.query(`
      CREATE TABLE "sales_returns" (
        "id" SERIAL PRIMARY KEY,
        "return_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "invoice_id" integer,
        "status" "sales_returns_status_enum" NOT NULL DEFAULT 'REQUESTED',
        "reason" character varying(1000) NOT NULL,
        "refund_amount" numeric(14,2),
        "created_by_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_returns_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_returns_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
        CONSTRAINT "fk_returns_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id"),
        CONSTRAINT "fk_returns_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_returns_number" ON "sales_returns" ("return_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_org" ON "sales_returns" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_customer" ON "sales_returns" ("customer_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_returns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_order_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quotation_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quotations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customers"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "sales_returns_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payments_method_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "invoices_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "sales_orders_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "quotations_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "customers_segment_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "customers_type_enum"`);
  }
}
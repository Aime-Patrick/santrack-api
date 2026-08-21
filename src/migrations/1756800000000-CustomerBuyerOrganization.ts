import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Links a customer to the buying organization, when the buyer is a business
 * on the platform.
 *
 * `customers.organization_id` is the seller - the tenant that owns the record -
 * so before this column there was nothing in the model naming the party being
 * sold to. Fulfilment read `organization_id` for the destination and addressed
 * every transfer back to the seller itself.
 *
 * Nullable on purpose, and left null for every existing row: a customer that
 * is not a registered organization is the ordinary case, and inferring the
 * link from a name or an email would hand custody of real stock to whoever
 * happened to match.
 */
export class CustomerBuyerOrganization1756800000000 implements MigrationInterface {
  name = 'CustomerBuyerOrganization1756800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers" ADD COLUMN "buyer_organization_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" ADD CONSTRAINT "fk_customer_buyer_organization"
         FOREIGN KEY ("buyer_organization_id") REFERENCES "organizations"("id")
         ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_customer_buyer_organization"
         ON "customers" ("buyer_organization_id")`,
    );

    // Fulfilment to a customer with no buying organization is a sale rather
    // than a transfer, so the order needs somewhere to record which one.
    await queryRunner.query(
      `ALTER TABLE "sales_orders" ADD COLUMN "sale_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_orders" ADD CONSTRAINT "fk_sales_order_sale"
         FOREIGN KEY ("sale_id") REFERENCES "sales"("id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "fk_sales_order_sale"`,
    );
    await queryRunner.query(`ALTER TABLE "sales_orders" DROP COLUMN IF EXISTS "sale_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_customer_buyer_organization"`);
    await queryRunner.query(
      `ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "fk_customer_buyer_organization"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" DROP COLUMN IF EXISTS "buyer_organization_id"`,
    );
  }
}

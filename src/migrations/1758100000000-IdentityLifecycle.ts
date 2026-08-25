import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separates minting a code from producing the thing it names (DR-08).
 *
 * Until now an identity was created at the moment of manufacture and was
 * immediately ACTIVE - held, countable, sellable stock. That order is
 * impossible for a real factory: labels have to be printed before they can be
 * applied, so a plant needs ten thousand codes in hand before it has made one
 * bottle. Minting on demand at production left them asking the system for
 * codes for goods that were already on the line.
 *
 * So a code now starts life GENERATED, meaning it exists and may be printed
 * and nothing more. It becomes ASSIGNED when a production order claims it, and
 * only becomes ACTIVE when production confirms a unit was actually made under
 * it. Codes that never made it - the bottle broke, the label was never used -
 * end CANCELLED with a reason, and are kept forever rather than deleted, so a
 * scan in the market answers "cancelled during production" instead of
 * "unknown code".
 *
 * Additive and reversible. No existing row changes status: everything already
 * in the table stands for a product that really was produced, which is what
 * ACTIVE has always meant, so leaving them alone is the correct migration.
 * The column default stays ACTIVE for the same reason and because Postgres
 * refuses to use an enum value added in the transaction that added it.
 */
export class IdentityLifecycle1758100000000 implements MigrationInterface {
  name = 'IdentityLifecycle1758100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- vocabularies ---------------------------------------------------
    // Added, never used, in this transaction. Postgres allows ALTER TYPE ...
    // ADD VALUE inside a transaction only so long as nothing reads the new
    // value before it commits, which is why nothing below writes one.

    for (const value of ['GENERATED', 'ASSIGNED', 'CANCELLED']) {
      await queryRunner.query(
        `ALTER TYPE "traceable_items_status_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
    for (const value of [
      'IDENTITY_GENERATED',
      'IDENTITY_ASSIGNED',
      'IDENTITY_CANCELLED',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "traceability_events_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    // --- the minting request ---------------------------------------------
    // Scoped to a product, not to a production order: the order comes later
    // and may not exist yet. A plant prints one run of labels and then
    // schedules six thousand bottles this week and four thousand next, which
    // is two orders drawing on one pool.
    //
    // No minted-count column, for the reason Product carries no quantity: it
    // would duplicate a fact the identities already hold, and the copy would
    // drift. Minted, produced and cancelled are all counted from
    // traceable_items.

    await queryRunner.query(`
      CREATE TABLE "identity_pools" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" int NOT NULL REFERENCES "organizations"("id"),
        "product_id" int NOT NULL REFERENCES "products"("id"),
        "requested_count" int NOT NULL,
        "status" varchar NOT NULL DEFAULT 'GENERATING',
        "failure_reason" varchar,
        "created_by_id" int REFERENCES "users"("id"),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "chk_pool_count_positive" CHECK ("requested_count" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_pool_product" ON "identity_pools" ("product_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pool_organization" ON "identity_pools" ("organization_id")`,
    );

    // --- the identity's side of it ---------------------------------------

    await queryRunner.query(`
      ALTER TABLE "traceable_items"
        ADD COLUMN "pool_id" int REFERENCES "identity_pools"("id"),
        ADD COLUMN "cancellation_reason" varchar,
        ADD COLUMN "cancelled_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "cancelled_by_id" int REFERENCES "users"("id")
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_item_pool" ON "traceable_items" ("pool_id")`,
    );

    /**
     * The reconciliation index. Every pool screen and every yield report asks
     * the same question - how many of this pool's codes are in each status -
     * and without this it is a sequential scan of the identity table per pool.
     */
    await queryRunner.query(`
      CREATE INDEX "idx_item_pool_status"
        ON "traceable_items" ("pool_id", "status")
        WHERE "pool_id" IS NOT NULL
    `);

    /**
     * A cancelled code has to say why, and only a cancelled code may.
     *
     * Enforced in the database rather than only in the service because this is
     * the row a consumer's scan reads years later, long after whichever
     * endpoint wrote it. "Cancelled, reason unknown" is not an answer anybody
     * can act on.
     *
     * Compared as text rather than against the enum literal, because Postgres
     * refuses to resolve an enum value added in the transaction adding it -
     * "New enum values must be committed before they can be used". The cast
     * sidesteps that without needing a second migration for one constraint.
     */
    await queryRunner.query(`
      ALTER TABLE "traceable_items"
        ADD CONSTRAINT "chk_item_cancellation_reason"
        CHECK (
          ("status"::text = 'CANCELLED' AND "cancellation_reason" IS NOT NULL)
          OR ("status"::text <> 'CANCELLED' AND "cancellation_reason" IS NULL)
        )
    `);
  }

  /**
   * Down drops what up added. It cannot remove the enum values: Postgres has
   * no ALTER TYPE ... DROP VALUE, and rebuilding the type would rewrite every
   * identity row to do it. Leaving three unused labels in a vocabulary costs
   * nothing and breaks nothing.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "traceable_items" DROP CONSTRAINT IF EXISTS "chk_item_cancellation_reason"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_item_pool_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_item_pool"`);
    await queryRunner.query(`
      ALTER TABLE "traceable_items"
        DROP COLUMN IF EXISTS "cancelled_by_id",
        DROP COLUMN IF EXISTS "cancelled_at",
        DROP COLUMN IF EXISTS "cancellation_reason",
        DROP COLUMN IF EXISTS "pool_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_pools"`);
  }
}

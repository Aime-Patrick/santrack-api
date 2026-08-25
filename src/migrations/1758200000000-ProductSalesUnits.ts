import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a product say what one unit of it is called, and what it is packed in
 * (DR-09 WU-2).
 *
 * `TraceableItem.quantity` has always been a bare integer, so stock could say
 * "2,016" and leave the reader to work out whether that was bottles, litres or
 * cases. `base_unit` gives that number its noun. `pack_unit` and
 * `units_per_pack` are the one conversion the platform knows: an order for
 * 2,000 bottles can be quoted as 84 cartons before any carton exists to be
 * measured, which is the one thing the cartons themselves cannot tell you.
 *
 * Deliberately not a unit-of-measure engine. One base unit, at most one pack,
 * one factor. A second sellable tier is a decision, not a column added quietly
 * later.
 *
 * All three are nullable with no backfill and no default. A null `base_unit`
 * means the screens keep showing a bare number, exactly as they do today, and
 * a product with no pack may only be sold in its base unit. Inventing units for
 * 128 existing products would be a claim nobody made.
 *
 * Varchar rather than a Postgres enum, matching `barcode_symbology` and
 * `traceability_level`: the vocabulary belongs to the trade, not to us, and
 * widening a database enum later is a migration and a lock for no gain.
 *
 * Nothing that counts, values or reserves stock reads these columns. The set
 * together rule (`pack_unit` and `units_per_pack` are both present or both
 * absent) is enforced in `ProductService.resolvePackaging`, not by a database
 * constraint: the refusal has to reach a person as a sentence explaining which
 * half is missing, and a CHECK violation reaches them as a driver error.
 */
export class ProductSalesUnits1758200000000 implements MigrationInterface {
  name = 'ProductSalesUnits1758200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN "base_unit" varchar NULL,
      ADD COLUMN "pack_unit" varchar NULL,
      ADD COLUMN "units_per_pack" integer NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      DROP COLUMN "units_per_pack",
      DROP COLUMN "pack_unit",
      DROP COLUMN "base_unit"
    `);
  }
}

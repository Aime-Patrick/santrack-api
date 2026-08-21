import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a product say how finely it is traced (DR-01).
 *
 * Registration previously minted one identity per physical unit and wrote
 * `quantity: 1` unconditionally, so a 10,000-pot yogurt run meant 10,000 rows
 * and 10,000 labels. The `quantity` column already existed and is documented as
 * "units this identity represents" — it was simply never set above one.
 *
 * Defaults to SERIAL so every existing product keeps exactly the behaviour it
 * has today. A varchar rather than a Postgres enum, matching the convention set
 * by `barcode_symbology`: the application validates it, and widening a database
 * enum later is a migration and a lock for no gain.
 */
export class ProductTraceabilityLevel1757600000000 implements MigrationInterface {
  name = 'ProductTraceabilityLevel1757600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN "traceability_level" varchar NOT NULL DEFAULT 'SERIAL'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN "traceability_level"
    `);
  }
}

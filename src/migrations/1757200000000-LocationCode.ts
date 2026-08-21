import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every location a scannable code.
 *
 * A warehouse does not choose its bays from a dropdown - each one carries a
 * printed barcode and the operator scans the shelf they are standing at. There
 * was nothing to print, so every stock movement meant reading a list of place
 * names on a screen while holding a carton.
 *
 * Existing locations are backfilled in id order and the shared counter is
 * advanced past them, so codes minted afterwards do not collide with the ones
 * handed out here.
 */
export class LocationCode1757200000000 implements MigrationInterface {
  name = 'LocationCode1757200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "locations" ADD COLUMN "code" varchar`);

    // Backfilled in id order so the numbering matches the order places were
    // registered, which is the order their labels were most likely printed.
    await queryRunner.query(`
      WITH numbered AS (
        SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS seq
        FROM "locations"
      )
      UPDATE "locations"
      SET "code" = 'LOC-' || LPAD(numbered.seq::text, 6, '0')
      FROM numbered
      WHERE "locations"."id" = numbered."id"
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_location_code"
      ON "locations" ("code")
      WHERE "code" IS NOT NULL
    `);

    // Move the shared counter past everything just handed out. Without this
    // the next location registered would be issued LOC-000001 again, and two
    // bays answering to one code is a scan that puts stock in the wrong place.
    await queryRunner.query(`
      INSERT INTO "code_sequences" ("prefix", "next_value")
      VALUES ('LOC', (SELECT COUNT(*) + 1 FROM "locations"))
      ON CONFLICT ("prefix") DO UPDATE
      SET "next_value" = GREATEST(
        "code_sequences"."next_value",
        (SELECT COUNT(*) + 1 FROM "locations")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_location_code"`);
    await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN "code"`);
    await queryRunner.query(`DELETE FROM "code_sequences" WHERE "prefix" = 'LOC'`);
  }
}

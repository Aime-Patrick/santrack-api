import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens the grain of a licence from (organization) to (organization, facility?)
 * — DR-07 §4.1, migration M1.
 *
 * Null means the organization as a whole; a value means this site only. Every
 * existing row stays null, and no backfill is attempted, because null is
 * factually correct for all of them: no licence on this platform was ever
 * issued against a site. Inventing one would fabricate a regulatory fact.
 *
 * Additive and reversible. The column is nullable, the foreign key is the only
 * constraint added, and `down()` removes both.
 *
 * This migration is meaningless on its own. A facility-scoped licence is only
 * read correctly once `apply()`, `issueProvisional()`, `effectiveLicense()`,
 * `assess()` and `listFor()` understand the grain — before that, a site licence
 * would be silently treated as organization-wide, which is worse than not
 * having the column. The five query changes ship in the same unit of work.
 *
 * One constraint the foreign key cannot express: a licence must not reference a
 * facility belonging to a different organization. Postgres CHECK constraints
 * cannot contain subqueries, so it is enforced in the resolver — which refuses
 * to treat such a row as governing — and asserted by test, rather than pretended
 * to be enforced here.
 */
export class LicenseFacility1757800000000 implements MigrationInterface {
  name = 'LicenseFacility1757800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "licenses"
      ADD COLUMN "facility_id" int NULL REFERENCES "facilities" ("id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_license_facility" ON "licenses" ("facility_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_license_facility"`);
    await queryRunner.query(`ALTER TABLE "licenses" DROP COLUMN "facility_id"`);
  }
}

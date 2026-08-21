import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Resolves two licence categories claiming the same activity.
 *
 * The database carried both `MFG`, inserted by the licensing migration, and
 * `MFG-001`, inserted by the development seed - both with
 * `activity = MANUFACTURING`. `issueProvisional` resolves the category with an
 * unordered `findOne({ where: { activity } })`, so which one a new
 * manufacturer's provisional licence pointed at was decided by whatever
 * Postgres happened to return first.
 *
 * `MFG` is canonical. It came from the schema migration rather than a
 * development fixture, it carries the real required-document list that gates
 * submission, and 61 of the 62 manufacturing licences already reference it.
 * `MFG-001` has no required documents at all, which would let an application be
 * submitted with no evidence attached.
 *
 * Deactivated rather than deleted: `LicenseCategory.active` is the project's
 * existing convention for withdrawing a category, and any licence that ever
 * referenced it keeps a readable record of what it was issued under. Nothing is
 * destroyed.
 */
export class CanonicalManufacturingLicenceCategory1757300000000
  implements MigrationInterface
{
  name = 'CanonicalManufacturingLicenceCategory1757300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Repoint any licence issued under the duplicate onto the canonical
    // category. Both authorise the same activity for the same organization
    // type, so no holder gains or loses anything by the move.
    await queryRunner.query(`
      UPDATE "licenses"
      SET "category_id" = (
        SELECT "id" FROM "license_categories" WHERE "code" = 'MFG'
      )
      WHERE "category_id" IN (
        SELECT "id" FROM "license_categories" WHERE "code" = 'MFG-001'
      )
      AND EXISTS (SELECT 1 FROM "license_categories" WHERE "code" = 'MFG')
    `);

    await queryRunner.query(`
      UPDATE "license_categories" SET "active" = false WHERE "code" = 'MFG-001'
    `);
  }

  /**
   * Reactivates the duplicate but deliberately does not move licences back.
   *
   * Reversing the repoint would mean guessing which licences were originally
   * issued under the duplicate, and that information is gone. Leaving them on
   * the canonical category is both correct and harmless - it is the state the
   * system should have been in all along.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "license_categories" SET "active" = true WHERE "code" = 'MFG-001'
    `);
  }
}

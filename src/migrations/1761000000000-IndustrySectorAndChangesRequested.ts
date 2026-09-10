import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds two capabilities to the organization registration flow:
 *
 * 1. `industry_sector` — which sector the business operates in (food,
 *    pharma, minerals, etc.). Captured at registration so the platform can
 *    route the application to the right regulatory authority for review.
 *    Nullable: existing organizations had no sector declared.
 *
 * 2. `CHANGES_REQUESTED` state in the onboarding status enum — a middle
 *    ground between approve and reject. The regulator can ask the applicant to
 *    correct or supply documents without closing the application. The applicant
 *    sees the review note, fixes what was asked, and resubmits (status returns
 *    to PENDING).
 *
 * 3. `review_note` — the regulator's message to the applicant when requesting
 *    changes. Cleared on resubmission.
 */
export class IndustrySectorAndChangesRequested1761000000000
  implements MigrationInterface
{
  name = 'IndustrySectorAndChangesRequested1761000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Industry sector ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "organizations_industry_sector_enum" AS ENUM (
        'FOOD_AND_BEVERAGE',
        'PHARMACEUTICALS',
        'COSMETICS',
        'MINING_AND_MINERALS',
        'AGRICULTURE_AND_EXPORTS',
        'GENERAL_MANUFACTURING',
        'DISTRIBUTION',
        'RETAIL',
        'OTHER'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "industry_sector" "organizations_industry_sector_enum" NULL
    `);

    // ── 2. CHANGES_REQUESTED status ─────────────────────────────────────────
    // PostgreSQL requires ALTER TYPE ... ADD VALUE which cannot run inside a
    // transaction. TypeORM wraps migrations in transactions by default, so we
    // use COMMIT / BEGIN to step outside the transaction just for this DDL.
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(`
      ALTER TYPE "organizations_onboarding_status_enum"
        ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED'
    `);
    await queryRunner.query(`BEGIN`);

    // ── 3. Review note ──────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "review_note" varchar(1000) NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "review_note"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "industry_sector"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "organizations_industry_sector_enum"`,
    );
    // NOTE: PostgreSQL does not support removing an enum value without
    // recreating the type. CHANGES_REQUESTED is left in the enum on rollback;
    // in practice a down migration restores the old codebase which simply
    // never writes that value.
  }
}

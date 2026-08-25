import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The record of why a production run was permitted — DR-07 §5, migration M2.
 *
 * Every production order created from here on names exactly one of these rows,
 * and that row carries the whole verdict: every check, the licences it relied
 * on by id *and* number *and* category code, the enforcement mode in force and
 * the version of the rules applied. A regulator asking in two years why a run
 * was allowed reads this, rather than watching today's rules be run against
 * today's licences and calling the answer history.
 *
 * `relied_on` stores numbers and codes alongside ids deliberately. Ids alone
 * are not an audit record: a `LicenseCategory` can be deactivated and a licence
 * renewed, and a decision that can no longer name what it relied on has
 * recorded nothing.
 *
 * Existing production orders keep `NULL`, and nothing backfills them. They were
 * created before any eligibility decision was ever made, so null is the honest
 * answer; a reconstructed verdict would be a fabricated audit record (DR §24
 * invariant 16).
 *
 * Append-only. No `UPDATE` and no `DELETE` against this table appears anywhere
 * in the codebase (invariants 15, 16), enforced by convention and asserted by
 * test rather than by a trigger, in keeping with how `license_events` and
 * `traceability_events` are held.
 *
 * Additive and reversible: one new table, one nullable column, two indexes.
 */
export class ProductionEligibilityDecision1757900000000 implements MigrationInterface {
  name = 'ProductionEligibilityDecision1757900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "production_eligibility_decisions" (
        "id"                 bigserial PRIMARY KEY,
        "organization_id"    int NOT NULL REFERENCES "organizations" ("id"),
        "facility_id"        int NULL     REFERENCES "facilities" ("id"),
        "product_id"         int NOT NULL REFERENCES "products" ("id"),
        "requested_quantity" int NOT NULL,
        "requested_date"     date NOT NULL,
        "eligible"           boolean NOT NULL,
        "blocking"           boolean NOT NULL,
        "enforcement_mode"   varchar(16) NOT NULL,
        "checks"             jsonb NOT NULL,
        "relied_on"          jsonb NOT NULL,
        "ruleset_version"    varchar(64) NOT NULL,
        "evaluated_at"       timestamptz NOT NULL DEFAULT now(),
        "evaluated_by_id"    int NULL REFERENCES "users" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ped_organization"
        ON "production_eligibility_decisions" ("organization_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ped_product"
        ON "production_eligibility_decisions" ("product_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "production_orders"
        ADD COLUMN "eligibility_decision_id" bigint NULL
        REFERENCES "production_eligibility_decisions" ("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "production_orders" DROP COLUMN "eligibility_decision_id"
    `);
    await queryRunner.query(`DROP TABLE "production_eligibility_decisions"`);
  }
}

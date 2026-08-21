import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes the traceability log able to address a lot as well as an identity.
 *
 * The canonical lifecycle assigns unit identities only after quality control
 * approves the run, so everything before that - production started, material
 * issued, production completed, the QC verdict itself - has no identity to
 * attach to. Those events address the batch instead, and a unit's timeline
 * reads them back, which is what makes section 20's "complete history of the
 * product" true rather than two logs that must be joined by hand.
 *
 * Also extends the batch lifecycle with the states quality control decides
 * between (use case 5: Approved / Rejected / Rework / Quarantine).
 */
export class BatchLevelEvents1756500000000 implements MigrationInterface {
  name = 'BatchLevelEvents1756500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- traceability_events: one subject, either an item or a batch --------

    await queryRunner.query(
      `ALTER TABLE "traceability_events" ALTER COLUMN "item_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "traceability_events" ADD COLUMN "batch_id" integer`,
    );
    await queryRunner.query(`
      ALTER TABLE "traceability_events"
        ADD CONSTRAINT "fk_event_batch"
        FOREIGN KEY ("batch_id") REFERENCES "batches"("id")
    `);

    // Exactly one subject. Enforced here rather than only in the application,
    // because an event with neither subject is history about nothing and an
    // event with both would appear twice on the same timeline.
    await queryRunner.query(`
      ALTER TABLE "traceability_events"
        ADD CONSTRAINT "chk_event_one_subject"
        CHECK (("item_id" IS NOT NULL) <> ("batch_id" IS NOT NULL))
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_event_batch" ON "traceability_events" ("batch_id")`,
    );

    // --- the new event vocabulary ------------------------------------------

    for (const value of [
      'PRODUCTION_STARTED',
      'MATERIAL_ISSUED',
      'PRODUCTION_COMPLETED',
      'QC_INSPECTED',
      'BATCH_APPROVED',
      'BATCH_REJECTED',
      'BATCH_REWORK',
      'PRODUCED_QUANTITY_AMENDED',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "traceability_events_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    // --- batch lifecycle states --------------------------------------------

    for (const value of ['PENDING_QC', 'APPROVED', 'REJECTED', 'REWORK']) {
      await queryRunner.query(
        `ALTER TYPE "batches_status_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    // Lets a lifted recall restore the verdict the lot had earned, rather
    // than promoting every lifted lot to the same state on the way back.
    await queryRunner.query(
      `ALTER TABLE "batches" ADD COLUMN "previous_status" "batches_status_enum"`,
    );

    // --- production_events: the amend operation's before-and-after ---------

    await queryRunner.query(
      `ALTER TABLE "production_events" ADD COLUMN "previous_quantity" numeric(14,3)`,
    );
    await queryRunner.query(
      `ALTER TYPE "production_events_type_enum" ADD VALUE IF NOT EXISTS 'QUANTITY_AMENDED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop a value from an enum type, so the added event and
    // status names survive a rollback. They are inert without the columns.
    await queryRunner.query(
      `ALTER TABLE "production_events" DROP COLUMN IF EXISTS "previous_quantity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "batches" DROP COLUMN IF EXISTS "previous_status"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_event_batch"`);
    await queryRunner.query(
      `ALTER TABLE "traceability_events" DROP CONSTRAINT IF EXISTS "chk_event_one_subject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "traceability_events" DROP CONSTRAINT IF EXISTS "fk_event_batch"`,
    );
    await queryRunner.query(
      `ALTER TABLE "traceability_events" DROP COLUMN IF EXISTS "batch_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "traceability_events" ALTER COLUMN "item_id" SET NOT NULL`,
    );
  }
}

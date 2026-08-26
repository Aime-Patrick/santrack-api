import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records how often each code is presented to the public verification
 * endpoint, including codes that resolve to nothing.
 *
 * `VERIFIED` (migration 1758300000000) covers scans of codes we recognise, but
 * a lifecycle event needs an identity to attach to, which left unknown codes
 * unrecorded: a fabricated label could be scanned a thousand times and leave
 * no trace at all.
 *
 * One row per distinct code rather than per scan. The endpoint is public and
 * anonymous, so a row per scan would let anyone with a loop decide how large
 * this table gets; counting bounds it by distinct codes in circulation.
 *
 * `item_id` is ON DELETE SET NULL on purpose. If an identity is ever removed,
 * the record that its code was being scanned must outlive it — that history is
 * most valuable exactly when the identity turns out not to be legitimate.
 */
export class VerificationAttempts1758400000000 implements MigrationInterface {
  name = 'VerificationAttempts1758400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "verification_attempts" (
        "id"            SERIAL PRIMARY KEY,
        "token"         varchar(256) NOT NULL,
        "known"         boolean NOT NULL DEFAULT false,
        "item_id"       integer NULL REFERENCES "traceable_items"("id") ON DELETE SET NULL,
        "attempts"      integer NOT NULL DEFAULT 1,
        "first_seen_at" timestamptz NOT NULL DEFAULT now(),
        "last_seen_at"  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Unique: the row is the code's whole history, and the upsert in
    // TraceabilityService.countVerificationAttempt depends on this conflict
    // target existing.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_verification_attempt_token" ON "verification_attempts" ("token")`,
    );
    // Ordering the review screen: most recently seen, and unknown-only.
    await queryRunner.query(
      `CREATE INDEX "idx_verification_attempt_last_seen" ON "verification_attempts" ("last_seen_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_verification_attempt_known" ON "verification_attempts" ("known")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "verification_attempts"`);
  }
}

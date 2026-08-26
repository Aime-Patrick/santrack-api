import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `VERIFIED` to the event vocabulary (proposal section 7, `VERIFY`).
 *
 * The consumer verification portal has been answering scans since it shipped
 * and writing nothing down, so the one event the proposal names for it was the
 * only one missing from the enum. `GET /api/verify/:token` was a pure read: a
 * counterfeit could be scanned in six towns on the same day and the platform
 * would hold no record that anyone had ever asked.
 *
 * Enum-value-only, and the value is added and not used in this transaction —
 * Postgres permits `ALTER TYPE ... ADD VALUE` inside a transaction only while
 * nothing reads the new value before it commits.
 *
 * `down()` drops nothing. Postgres has no `ALTER TYPE ... DROP VALUE`, and the
 * house pattern for this (see `IdentityLifecycle1758100000000`) is to leave
 * added values in place: an unused enum member costs nothing, and reverting
 * the code stops anything writing it.
 */
export class VerificationEvent1758300000000 implements MigrationInterface {
  name = 'VerificationEvent1758300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "traceability_events_type_enum" ADD VALUE IF NOT EXISTS 'VERIFIED'`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally empty. See the note above.
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-user notification inbox (technical proposal section 1, "automated
 * license expiry notifications", and the alerting the section 21 dashboard
 * depends on).
 *
 * Timestamped after Security1756200000000 so it applies in the order it was
 * written. An earlier draft carried 1700000000000, which sorts before
 * InitialSchema and would have created this table before "users" existed on a
 * fresh database.
 */
export class Notifications1756300000000 implements MigrationInterface {
  name = 'Notifications1756300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "notification_type_enum" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR')
    `);

    // Every other table in the schema declares its foreign keys; a notification
    // addressed to a user who no longer exists is unreadable by anyone, so the
    // row goes with the account rather than being left behind.
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "type" "notification_type_enum" NOT NULL DEFAULT 'INFO',
        "title" character varying NOT NULL,
        "message" text NOT NULL,
        "module" character varying,
        "action_url" character varying,
        "read" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP,
        CONSTRAINT "fk_notifications_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_notification_user" ON "notifications" ("user_id")`,
    );
    // Serves the unread badge, which is the most frequent read in the module.
    await queryRunner.query(
      `CREATE INDEX "idx_notification_read" ON "notifications" ("user_id", "read")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notification_created" ON "notifications" ("created_at")`,
    );
    // Supports the expiry sweep without scanning the table.
    await queryRunner.query(
      `CREATE INDEX "idx_notification_expires" ON "notifications" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_type_enum"`);
  }
}

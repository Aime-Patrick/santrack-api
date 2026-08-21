import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Security hardening (technical proposal section 15): the append-only audit
 * log of every privileged action - who did it, on whose organization, to what
 * path, with what outcome. Created as part of the final security batch along
 * with rate limiting and response hardening headers.
 */
export class Security1756200000000 implements MigrationInterface {
  name = 'Security1756200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" SERIAL PRIMARY KEY,
        "actor_id" integer,
        "organization_id" integer,
        "method" character varying(8) NOT NULL,
        "path" character varying(512) NOT NULL,
        "status_code" integer NOT NULL,
        "detail" character varying(1000),
        "remote_address" character varying(64),
        "performed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_audit_logs_actor"
          FOREIGN KEY ("actor_id") REFERENCES "users"("id"),
        CONSTRAINT "fk_audit_logs_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_audit_org" ON "audit_logs" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "idx_audit_actor" ON "audit_logs" ("actor_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_path" ON "audit_logs" ("method", "path")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_at" ON "audit_logs" ("performed_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
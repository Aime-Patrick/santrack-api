import { MigrationInterface, QueryRunner } from 'typeorm';

/** Configurable read-only oversight scope; does not grant operational case access. */
export class RegulatoryOversightScopes1760100000000 implements MigrationInterface {
  name = 'RegulatoryOversightScopes1760100000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "regulatory_oversight_scopes" ("id" SERIAL NOT NULL, "oversight_organization_id" integer NOT NULL, "authority_id" integer NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_regulatory_oversight_scopes" PRIMARY KEY ("id"), CONSTRAINT "UQ_regulatory_oversight_scope" UNIQUE ("oversight_organization_id", "authority_id"), CONSTRAINT "FK_regulatory_oversight_scope_organization" FOREIGN KEY ("oversight_organization_id") REFERENCES "organizations"("id"), CONSTRAINT "FK_regulatory_oversight_scope_authority" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authorities"("id"))`);
    await queryRunner.query(`CREATE INDEX "idx_regulatory_oversight_scope_organization" ON "regulatory_oversight_scopes" ("oversight_organization_id")`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`DROP TABLE "regulatory_oversight_scopes"`); }
}

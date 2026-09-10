import { MigrationInterface, QueryRunner } from 'typeorm';

export class RegistrationInfoRequests1761800000000 implements MigrationInterface {
  name = 'RegistrationInfoRequests1761800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."registration_info_requests_status_enum"
        AS ENUM ('PENDING', 'RESPONDED', 'EXPIRED')
    `);

    await queryRunner.query(`
      CREATE TABLE "registration_info_requests" (
        "id"                            SERIAL PRIMARY KEY,
        "organization_id"               INTEGER NOT NULL,
        "token"                         UUID NOT NULL,
        "request_message"               TEXT NOT NULL,
        "requested_fields"              JSONB NOT NULL DEFAULT '[]',
        "expires_at"                    TIMESTAMP WITH TIME ZONE NOT NULL,
        "status"                        "public"."registration_info_requests_status_enum"
                                          NOT NULL DEFAULT 'PENDING',
        "response_data"                 JSONB,
        "response_attachment_key"       VARCHAR,
        "response_attachment_filename"  VARCHAR,
        "responded_at"                  TIMESTAMP WITH TIME ZONE,
        "created_by_id"                 INTEGER,
        "created_at"                    TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"                    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_info_request_organization"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_info_request_token"
        ON "registration_info_requests" ("token")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_info_request_org"
        ON "registration_info_requests" ("organization_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "registration_info_requests"`);
    await queryRunner.query(`
      DROP TYPE "public"."registration_info_requests_status_enum"
    `);
  }
}

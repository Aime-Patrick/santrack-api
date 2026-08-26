import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Org-scoped share links for product categories.
 *
 * Categories are platform-global; products are not. A single token on the
 * category row would leak every manufacturer's catalogue under that taxonomy
 * node. One live link per (organization, category) keeps the public surface
 * scoped to the issuer.
 */
export class CategoryShareLinks1758600000000 implements MigrationInterface {
  name = 'CategoryShareLinks1758600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "category_share_links" (
        "id"                SERIAL PRIMARY KEY,
        "category_id"       integer NOT NULL REFERENCES "product_categories"("id") ON DELETE CASCADE,
        "organization_id"   integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "token"             uuid NOT NULL,
        "active"            boolean NOT NULL DEFAULT true,
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        "rotated_at"        timestamptz NULL,
        "created_by_user_id" integer NULL REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_category_share_link_token"
        ON "category_share_links" ("token")
    `);

    // At most one live link per org+category. Rotated rows stay for audit
    // with active=false and are excluded from this index.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_category_share_link_live"
        ON "category_share_links" ("organization_id", "category_id")
        WHERE "active" = true
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_category_share_link_category"
        ON "category_share_links" ("category_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "category_share_links"`);
  }
}

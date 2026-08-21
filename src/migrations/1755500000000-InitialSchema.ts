import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The SANTRACK traceability schema.
 *
 * Written as a migration rather than left to the ORM: the platform is deployed
 * to a pilot and then to many organizations, and a schema that an ORM invents
 * at boot cannot be reviewed, replayed or rolled back.
 */
export class InitialSchema1755500000000 implements MigrationInterface {
  name = 'InitialSchema1755500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- enums

    await queryRunner.query(`
      CREATE TYPE "organizations_type_enum" AS ENUM
        ('MANUFACTURER','WAREHOUSE','DISTRIBUTOR','RETAILER','SHOP','REGULATOR','CONSUMER')
    `);
    await queryRunner.query(`
      CREATE TYPE "users_role_enum" AS ENUM
        ('SYSTEM_ADMIN','ORG_ADMIN','PRODUCTION_MANAGER','PRODUCTION_OFFICER',
         'WAREHOUSE_MANAGER','WAREHOUSE_OFFICER','QUALITY_OFFICER',
         'LOGISTICS_OFFICER','SALES_OFFICER','MANAGEMENT','AUDITOR')
    `);
    await queryRunner.query(`
      CREATE TYPE "locations_type_enum" AS ENUM
        ('FACTORY','WAREHOUSE','DISTRIBUTION_CENTER','STORE','SHOP','VEHICLE')
    `);
    await queryRunner.query(`
      CREATE TYPE "batches_status_enum" AS ENUM
        ('ACTIVE','RECALLED','QUARANTINED','CLOSED')
    `);
    await queryRunner.query(`
      CREATE TYPE "traceable_items_kind_enum" AS ENUM ('UNIT','PACKAGE')
    `);
    await queryRunner.query(`
      CREATE TYPE "traceable_items_package_type_enum" AS ENUM
        ('BOX','CARTON','CASE','SACK','CRATE','PALLET')
    `);
    await queryRunner.query(`
      CREATE TYPE "traceable_items_status_enum" AS ENUM
        ('ACTIVE','IN_TRANSIT','SOLD','RETURNED','QUARANTINED','RECALLED',
         'EXPIRED','DAMAGED','DESTROYED')
    `);
    await queryRunner.query(`
      CREATE TYPE "traceable_items_seal_state_enum" AS ENUM ('SEALED','OPEN','EMPTY')
    `);
    await queryRunner.query(`
      CREATE TYPE "traceability_events_type_enum" AS ENUM
        ('MANUFACTURED','PACKAGE_CREATED','PACKAGED','PACKAGE_OPENED','UNIT_REMOVED',
         'DISPATCHED','RECEIVED','RELOCATED','SOLD','RETURNED','RECALLED',
         'QUARANTINED','RELEASED','EXPIRED','DAMAGED','DESTROYED','CORRECTION')
    `);
    await queryRunner.query(`
      CREATE TYPE "transfers_status_enum" AS ENUM ('DISPATCHED','RECEIVED','CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE "sales_type_enum" AS ENUM ('BUSINESS','CONSUMER')
    `);

    // --------------------------------------------------------- tables

    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id" SERIAL PRIMARY KEY,
        "name" character varying NOT NULL,
        "type" "organizations_type_enum" NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_organizations_name" ON "organizations" ("name")`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" SERIAL PRIMARY KEY,
        "email" character varying NOT NULL,
        "password_hash" character varying NOT NULL,
        "full_name" character varying NOT NULL,
        "organization_id" integer,
        "role" "users_role_enum" NOT NULL DEFAULT 'ORG_ADMIN',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_users_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")`,
    );

    await queryRunner.query(`
      CREATE TABLE "locations" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "type" "locations_type_enum" NOT NULL,
        "address" character varying,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "fk_locations_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_location_org" ON "locations" ("organization_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" SERIAL PRIMARY KEY,
        "name" character varying NOT NULL,
        "sku" character varying NOT NULL,
        "category" character varying,
        "brand" character varying,
        "model" character varying,
        "specification" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_products_sku" ON "products" ("sku")`,
    );

    await queryRunner.query(`
      CREATE TABLE "batches" (
        "id" SERIAL PRIMARY KEY,
        "product_id" integer NOT NULL,
        "batch_code" character varying NOT NULL,
        "manufacturer_id" integer,
        "manufactured_on" date,
        "expires_on" date,
        "status" "batches_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "status_reason" character varying(1000),
        "status_changed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_batch_product_code" UNIQUE ("product_id", "batch_code"),
        CONSTRAINT "fk_batches_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id"),
        CONSTRAINT "fk_batches_manufacturer"
          FOREIGN KEY ("manufacturer_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_batch_product" ON "batches" ("product_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "code_sequences" (
        "id" SERIAL PRIMARY KEY,
        "prefix" character varying NOT NULL,
        "next_value" bigint NOT NULL DEFAULT 1
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_code_sequences_prefix" ON "code_sequences" ("prefix")`,
    );

    await queryRunner.query(`
      CREATE TABLE "traceable_items" (
        "id" SERIAL PRIMARY KEY,
        "qr_code" character varying NOT NULL,
        "code" character varying NOT NULL,
        "kind" "traceable_items_kind_enum" NOT NULL,
        "package_type" "traceable_items_package_type_enum",
        "product_id" integer,
        "batch_id" integer,
        "serial_number" character varying,
        "quantity" integer NOT NULL DEFAULT 1,
        "status" "traceable_items_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "seal_state" "traceable_items_seal_state_enum",
        "parent_id" integer,
        "holder_id" integer,
        "location_id" integer,
        "consumer_ref" character varying,
        "expires_on" date,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "version" integer NOT NULL,
        CONSTRAINT "fk_items_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id"),
        CONSTRAINT "fk_items_batch"
          FOREIGN KEY ("batch_id") REFERENCES "batches"("id"),
        CONSTRAINT "fk_items_parent"
          FOREIGN KEY ("parent_id") REFERENCES "traceable_items"("id"),
        CONSTRAINT "fk_items_holder"
          FOREIGN KEY ("holder_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_items_location"
          FOREIGN KEY ("location_id") REFERENCES "locations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_items_qr_code" ON "traceable_items" ("qr_code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_items_code" ON "traceable_items" ("code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_item_parent" ON "traceable_items" ("parent_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_item_holder" ON "traceable_items" ("holder_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_item_batch" ON "traceable_items" ("batch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_item_product" ON "traceable_items" ("product_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "traceability_events" (
        "id" SERIAL PRIMARY KEY,
        "item_id" integer NOT NULL,
        "type" "traceability_events_type_enum" NOT NULL,
        "source_organization_id" integer,
        "source_location_id" integer,
        "destination_organization_id" integer,
        "destination_location_id" integer,
        "related_item_id" integer,
        "quantity" integer,
        "actor_id" integer,
        "consumer_ref" character varying,
        "device_id" character varying,
        "client_event_id" character varying,
        "notes" character varying(1000),
        "compensates_event_id" integer,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "recorded_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_events_item"
          FOREIGN KEY ("item_id") REFERENCES "traceable_items"("id"),
        CONSTRAINT "fk_events_related_item"
          FOREIGN KEY ("related_item_id") REFERENCES "traceable_items"("id"),
        CONSTRAINT "fk_events_source_org"
          FOREIGN KEY ("source_organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_events_source_location"
          FOREIGN KEY ("source_location_id") REFERENCES "locations"("id"),
        CONSTRAINT "fk_events_destination_org"
          FOREIGN KEY ("destination_organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_events_destination_location"
          FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id"),
        CONSTRAINT "fk_events_actor"
          FOREIGN KEY ("actor_id") REFERENCES "users"("id"),
        CONSTRAINT "fk_events_compensates"
          FOREIGN KEY ("compensates_event_id") REFERENCES "traceability_events"("id")
      )
    `);
    // The guarantee behind offline idempotency: a replayed queue physically
    // cannot insert the same operation twice (business rule 12).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_events_client_event_id" ON "traceability_events" ("client_event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_event_item" ON "traceability_events" ("item_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_event_occurred" ON "traceability_events" ("occurred_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_event_type" ON "traceability_events" ("type")`,
    );

    await queryRunner.query(`
      CREATE TABLE "transfers" (
        "id" SERIAL PRIMARY KEY,
        "reference" character varying NOT NULL,
        "source_organization_id" integer NOT NULL,
        "source_location_id" integer,
        "destination_organization_id" integer NOT NULL,
        "destination_location_id" integer,
        "status" "transfers_status_enum" NOT NULL DEFAULT 'DISPATCHED',
        "dispatched_by_id" integer,
        "received_by_id" integer,
        "dispatched_at" TIMESTAMP NOT NULL DEFAULT now(),
        "received_at" TIMESTAMP WITH TIME ZONE,
        "notes" character varying(1000),
        CONSTRAINT "fk_transfers_source_org"
          FOREIGN KEY ("source_organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_transfers_source_location"
          FOREIGN KEY ("source_location_id") REFERENCES "locations"("id"),
        CONSTRAINT "fk_transfers_destination_org"
          FOREIGN KEY ("destination_organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_transfers_destination_location"
          FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id"),
        CONSTRAINT "fk_transfers_dispatched_by"
          FOREIGN KEY ("dispatched_by_id") REFERENCES "users"("id"),
        CONSTRAINT "fk_transfers_received_by"
          FOREIGN KEY ("received_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_transfers_reference" ON "transfers" ("reference")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_transfer_source" ON "transfers" ("source_organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_transfer_destination" ON "transfers" ("destination_organization_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "transfer_lines" (
        "id" SERIAL PRIMARY KEY,
        "transfer_id" integer NOT NULL,
        "item_id" integer NOT NULL,
        CONSTRAINT "fk_transfer_lines_transfer"
          FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_transfer_lines_item"
          FOREIGN KEY ("item_id") REFERENCES "traceable_items"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_transfer_line_transfer" ON "transfer_lines" ("transfer_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "sales" (
        "id" SERIAL PRIMARY KEY,
        "reference" character varying NOT NULL,
        "type" "sales_type_enum" NOT NULL,
        "seller_organization_id" integer NOT NULL,
        "seller_location_id" integer,
        "buyer_organization_id" integer,
        "consumer_ref" character varying,
        "sold_by_id" integer,
        "total_amount" numeric(14,2),
        "transfer_id" integer,
        "sold_at" TIMESTAMP NOT NULL DEFAULT now(),
        "notes" character varying(1000),
        CONSTRAINT "fk_sales_seller_org"
          FOREIGN KEY ("seller_organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_sales_seller_location"
          FOREIGN KEY ("seller_location_id") REFERENCES "locations"("id"),
        CONSTRAINT "fk_sales_buyer_org"
          FOREIGN KEY ("buyer_organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_sales_sold_by"
          FOREIGN KEY ("sold_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_sales_reference" ON "sales" ("reference")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sale_seller" ON "sales" ("seller_organization_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "sale_lines" (
        "id" SERIAL PRIMARY KEY,
        "sale_id" integer NOT NULL,
        "item_id" integer NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "unit_price" numeric(14,2),
        CONSTRAINT "fk_sale_lines_sale"
          FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_sale_lines_item"
          FOREIGN KEY ("item_id") REFERENCES "traceable_items"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_sale_line_sale" ON "sale_lines" ("sale_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sale_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sales"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transfer_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transfers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "traceability_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "traceable_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "code_sequences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "batches"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "locations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organizations"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "sales_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "transfers_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "traceability_events_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "traceable_items_seal_state_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "traceable_items_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "traceable_items_package_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "traceable_items_kind_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "batches_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "locations_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "organizations_type_enum"`);
  }
}

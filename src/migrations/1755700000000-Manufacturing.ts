import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manufacturing management (technical proposal section 3): raw materials,
 * bills of materials, machines, production orders with material allocation
 * and consumption, and quality inspections.
 *
 * Production is deliberately light on new state: completing an order opens a
 * row in the existing "batches" table, and finished goods are registered
 * through the existing items module against that batch. Manufacturing data
 * therefore becomes traceable product without a second identity system.
 */
export class Manufacturing1755700000000 implements MigrationInterface {
  name = 'Manufacturing1755700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- enums

    await queryRunner.query(`
      CREATE TYPE "machines_status_enum" AS ENUM ('ACTIVE','INACTIVE','MAINTENANCE')
    `);
    await queryRunner.query(`
      CREATE TYPE "production_orders_status_enum" AS ENUM
        ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED','CLOSED')
    `);
    await queryRunner.query(`
      CREATE TYPE "production_events_type_enum" AS ENUM
        ('CREATED','STARTED','MATERIAL_ALLOCATED','MATERIAL_ISSUED',
         'COMPLETED','CANCELLED','CLOSED')
    `);
    await queryRunner.query(`
      CREATE TYPE "quality_inspections_result_enum" AS ENUM
        ('APPROVED','REJECTED','REWORK','QUARANTINE')
    `);

    // --------------------------------------------------------- raw materials

    await queryRunner.query(`
      CREATE TABLE "raw_materials" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "code" character varying NOT NULL,
        "category" character varying,
        "unit_of_measure" character varying NOT NULL,
        "unit_cost" numeric(14,2) NOT NULL DEFAULT 0,
        "reorder_level" numeric(14,3) NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_raw_material_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_raw_materials_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_raw_material_org" ON "raw_materials" ("organization_id")`,
    );

    // ------------------------------------------------------------ machines

    await queryRunner.query(`
      CREATE TABLE "machines" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "type" character varying,
        "status" "machines_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_machine_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_machines_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_machine_org" ON "machines" ("organization_id")`,
    );

    // ------------------------------------------------------------- bills

    await queryRunner.query(`
      CREATE TABLE "bill_of_materials" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "name" character varying,
        "version" integer NOT NULL DEFAULT 1,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_bom_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_bom_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bom_org" ON "bill_of_materials" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bom_product" ON "bill_of_materials" ("product_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "bill_of_material_lines" (
        "id" SERIAL PRIMARY KEY,
        "bom_id" integer NOT NULL,
        "material_id" integer NOT NULL,
        "quantity_per_unit" numeric(14,3) NOT NULL,
        "wastage_percent" numeric(5,2) NOT NULL DEFAULT 0,
        CONSTRAINT "fk_bom_line_bom"
          FOREIGN KEY ("bom_id") REFERENCES "bill_of_materials"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_bom_line_material"
          FOREIGN KEY ("material_id") REFERENCES "raw_materials"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bom_line_bom" ON "bill_of_material_lines" ("bom_id")`,
    );

    // ------------------------------------------------------ production orders

    await queryRunner.query(`
      CREATE TABLE "production_orders" (
        "id" SERIAL PRIMARY KEY,
        "order_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "bom_id" integer,
        "machine_id" integer,
        "planned_quantity" integer NOT NULL,
        "produced_quantity" integer NOT NULL DEFAULT 0,
        "status" "production_orders_status_enum" NOT NULL DEFAULT 'PLANNED',
        "scheduled_start_on" date,
        "scheduled_end_on" date,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "batch_id" integer,
        "notes" character varying(1000),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_production_orders_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_production_orders_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id"),
        CONSTRAINT "fk_production_orders_bom"
          FOREIGN KEY ("bom_id") REFERENCES "bill_of_materials"("id"),
        CONSTRAINT "fk_production_orders_machine"
          FOREIGN KEY ("machine_id") REFERENCES "machines"("id"),
        CONSTRAINT "fk_production_orders_batch"
          FOREIGN KEY ("batch_id") REFERENCES "batches"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_production_orders_number" ON "production_orders" ("order_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_production_order_org" ON "production_orders" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_production_order_product" ON "production_orders" ("product_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_production_order_status" ON "production_orders" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "production_order_materials" (
        "id" SERIAL PRIMARY KEY,
        "production_order_id" integer NOT NULL,
        "material_id" integer NOT NULL,
        "allocated_quantity" numeric(14,3) NOT NULL DEFAULT 0,
        "consumed_quantity" numeric(14,3) NOT NULL DEFAULT 0,
        "wastage_percent" numeric(5,2) NOT NULL DEFAULT 0,
        CONSTRAINT "fk_pom_order"
          FOREIGN KEY ("production_order_id")
            REFERENCES "production_orders"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pom_material"
          FOREIGN KEY ("material_id") REFERENCES "raw_materials"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_pom_order" ON "production_order_materials" ("production_order_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "production_events" (
        "id" SERIAL PRIMARY KEY,
        "production_order_id" integer NOT NULL,
        "type" "production_events_type_enum" NOT NULL,
        "actor_id" integer,
        "quantity" numeric(14,3),
        "notes" character varying(1000),
        "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_production_events_order"
          FOREIGN KEY ("production_order_id")
            REFERENCES "production_orders"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_production_events_actor"
          FOREIGN KEY ("actor_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_production_event_order" ON "production_events" ("production_order_id")`,
    );

    // ------------------------------------------------------- quality control

    await queryRunner.query(`
      CREATE TABLE "quality_inspections" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "production_order_id" integer,
        "batch_id" integer,
        "inspector_id" integer NOT NULL,
        "result" "quality_inspections_result_enum" NOT NULL,
        "notes" character varying(1000),
        "tested_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_inspections_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_inspections_production_order"
          FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id"),
        CONSTRAINT "fk_inspections_batch"
          FOREIGN KEY ("batch_id") REFERENCES "batches"("id"),
        CONSTRAINT "fk_inspections_inspector"
          FOREIGN KEY ("inspector_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_inspection_org" ON "quality_inspections" ("organization_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "quality_inspections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "production_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "production_order_materials"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "production_orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bill_of_material_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bill_of_materials"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "machines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "raw_materials"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "quality_inspections_result_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "production_events_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "production_orders_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "machines_status_enum"`);
  }
}

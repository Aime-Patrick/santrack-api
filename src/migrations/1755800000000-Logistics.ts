import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Logistics management (technical proposal section 5): transporters, their
 * vehicles and drivers, routes, and the shipments that carry a dispatched
 * transfer physically between parties - including delivery tracking and
 * proof of delivery.
 *
 * A shipment wraps exactly one dispatched transfer: custody still moves
 * through the existing transfer module, and the shipment is the logistics
 * layer on top of it.
 */
export class Logistics1755800000000 implements MigrationInterface {
  name = 'Logistics1755800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- enums

    await queryRunner.query(`
      CREATE TYPE "vehicles_type_enum" AS ENUM
        ('TRUCK','VAN','TRAILER','PICKUP','MOTORCYCLE','OTHER')
    `);
    await queryRunner.query(`
      CREATE TYPE "shipments_status_enum" AS ENUM
        ('PENDING','IN_TRANSIT','DELIVERED','CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE "shipment_events_type_enum" AS ENUM
        ('CREATED','DEPARTED','DELIVERED','CANCELLED')
    `);

    // ----------------------------------------------------- transporters

    await queryRunner.query(`
      CREATE TABLE "transporters" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "code" character varying NOT NULL,
        "contact_person" character varying,
        "phone" character varying,
        "email" character varying,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_transporter_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_transporters_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_transporter_org" ON "transporters" ("organization_id")`,
    );

    // ---------------------------------------------------------- vehicles

    await queryRunner.query(`
      CREATE TABLE "vehicles" (
        "id" SERIAL PRIMARY KEY,
        "transporter_id" integer NOT NULL,
        "registration_number" character varying NOT NULL,
        "type" "vehicles_type_enum" NOT NULL DEFAULT 'TRUCK',
        "capacity" numeric(10,2),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_vehicle_transporter_registration"
          UNIQUE ("transporter_id","registration_number"),
        CONSTRAINT "fk_vehicles_transporter"
          FOREIGN KEY ("transporter_id") REFERENCES "transporters"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vehicle_transporter" ON "vehicles" ("transporter_id")`,
    );

    // ----------------------------------------------------------- drivers

    await queryRunner.query(`
      CREATE TABLE "drivers" (
        "id" SERIAL PRIMARY KEY,
        "transporter_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "license_number" character varying,
        "phone" character varying,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_driver_transporter_license"
          UNIQUE ("transporter_id","license_number"),
        CONSTRAINT "fk_drivers_transporter"
          FOREIGN KEY ("transporter_id") REFERENCES "transporters"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_driver_transporter" ON "drivers" ("transporter_id")`,
    );

    // ------------------------------------------------------------ routes

    await queryRunner.query(`
      CREATE TABLE "routes" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "source_location_id" integer NOT NULL,
        "destination_location_id" integer NOT NULL,
        "distance_km" numeric(8,2),
        "expected_hours" numeric(5,2),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_routes_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_routes_source_location"
          FOREIGN KEY ("source_location_id") REFERENCES "locations"("id"),
        CONSTRAINT "fk_routes_destination_location"
          FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_route_org" ON "routes" ("organization_id")`,
    );

    // --------------------------------------------------------- shipments

    await queryRunner.query(`
      CREATE TABLE "shipments" (
        "id" SERIAL PRIMARY KEY,
        "shipment_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "transfer_id" integer NOT NULL,
        "transporter_id" integer NOT NULL,
        "vehicle_id" integer,
        "driver_id" integer,
        "route_id" integer,
        "destination_organization_id" integer,
        "status" "shipments_status_enum" NOT NULL DEFAULT 'PENDING',
        "scheduled_departure_on" date,
        "scheduled_delivery_on" date,
        "departed_at" TIMESTAMP WITH TIME ZONE,
        "delivered_at" TIMESTAMP WITH TIME ZONE,
        "pod_recipient_name" character varying,
        "pod_notes" character varying(1000),
        "created_by_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uq_shipments_transfer" UNIQUE ("transfer_id"),
        CONSTRAINT "fk_shipments_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_shipments_transfer"
          FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id"),
        CONSTRAINT "fk_shipments_transporter"
          FOREIGN KEY ("transporter_id") REFERENCES "transporters"("id"),
        CONSTRAINT "fk_shipments_vehicle"
          FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id"),
        CONSTRAINT "fk_shipments_driver"
          FOREIGN KEY ("driver_id") REFERENCES "drivers"("id"),
        CONSTRAINT "fk_shipments_route"
          FOREIGN KEY ("route_id") REFERENCES "routes"("id"),
        CONSTRAINT "fk_shipments_destination_organization"
          FOREIGN KEY ("destination_organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_shipments_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_shipments_number" ON "shipments" ("shipment_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_shipment_org" ON "shipments" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_shipment_destination_org"
        ON "shipments" ("destination_organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_shipment_status" ON "shipments" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "shipment_events" (
        "id" SERIAL PRIMARY KEY,
        "shipment_id" integer NOT NULL,
        "type" "shipment_events_type_enum" NOT NULL,
        "actor_id" integer,
        "notes" character varying(1000),
        "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_shipment_events_shipment"
          FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_shipment_events_actor"
          FOREIGN KEY ("actor_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_shipment_event_shipment"
        ON "shipment_events" ("shipment_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "shipment_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "shipments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "routes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "drivers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transporters"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "shipment_events_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "shipments_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vehicles_type_enum"`);
  }
}
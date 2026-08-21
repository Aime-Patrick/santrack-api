import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payroll & HR (technical proposal section 8): departments, job positions,
 * employees with basic salary and overtime rate, recurring pay items
 * (allowances and deductions), attendance with overtime hours, leave
 * requests, and the monthly payroll run that turns all of it into payslips.
 */
export class Payroll1756100000000 implements MigrationInterface {
  name = 'Payroll1756100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- enums

    await queryRunner.query(`
      CREATE TYPE "employees_status_enum" AS ENUM
        ('ACTIVE','ON_LEAVE','TERMINATED')
    `);
    await queryRunner.query(`
      CREATE TYPE "employee_pay_items_type_enum" AS ENUM
        ('ALLOWANCE','DEDUCTION')
    `);
    await queryRunner.query(`
      CREATE TYPE "attendance_status_enum" AS ENUM
        ('PRESENT','ABSENT','LEAVE','HALF_DAY')
    `);
    await queryRunner.query(`
      CREATE TYPE "leaves_type_enum" AS ENUM
        ('ANNUAL','SICK','UNPAID','OTHER')
    `);
    await queryRunner.query(`
      CREATE TYPE "leaves_status_enum" AS ENUM
        ('REQUESTED','APPROVED','REJECTED')
    `);
    await queryRunner.query(`
      CREATE TYPE "payroll_runs_status_enum" AS ENUM
        ('DRAFT','PAID')
    `);

    // ---------------------------------------------------------- departments

    await queryRunner.query(`
      CREATE TABLE "departments" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_department_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_departments_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_department_org" ON "departments" ("organization_id")`,
    );

    // ------------------------------------------------------- job positions

    await queryRunner.query(`
      CREATE TABLE "job_positions" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "code" character varying NOT NULL,
        "title" character varying NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_job_position_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_job_positions_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_job_position_org" ON "job_positions" ("organization_id")`,
    );

    // ------------------------------------------------------------ employees

    await queryRunner.query(`
      CREATE TABLE "employees" (
        "id" SERIAL PRIMARY KEY,
        "employee_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "department_id" integer,
        "job_position_id" integer,
        "status" "employees_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "hire_date" date,
        "phone" character varying,
        "email" character varying,
        "base_salary" numeric(14,2) NOT NULL DEFAULT '0',
        "overtime_rate" numeric(14,2) NOT NULL DEFAULT '0',
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_employee_org_number" UNIQUE ("organization_id","employee_number"),
        CONSTRAINT "fk_employees_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_employees_department"
          FOREIGN KEY ("department_id") REFERENCES "departments"("id"),
        CONSTRAINT "fk_employees_job_position"
          FOREIGN KEY ("job_position_id") REFERENCES "job_positions"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_employee_org" ON "employees" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_employee_department" ON "employees" ("department_id")`,
    );

    // -------------------------------------------------------- employee pay items

    await queryRunner.query(`
      CREATE TABLE "employee_pay_items" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "employee_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "type" "employee_pay_items_type_enum" NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_employee_pay_items_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_employee_pay_items_employee"
          FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_pay_item_org" ON "employee_pay_items" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pay_item_employee" ON "employee_pay_items" ("employee_id")`,
    );

    // ------------------------------------------------------------ attendance

    await queryRunner.query(`
      CREATE TABLE "attendance" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "employee_id" integer NOT NULL,
        "attendance_date" date NOT NULL,
        "status" "attendance_status_enum" NOT NULL DEFAULT 'PRESENT',
        "overtime_hours" numeric(6,2) NOT NULL DEFAULT '0',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_attendance_employee_date"
          UNIQUE ("employee_id","attendance_date"),
        CONSTRAINT "fk_attendance_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_attendance_employee"
          FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_attendance_org" ON "attendance" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_attendance_employee" ON "attendance" ("employee_id")`,
    );

    // --------------------------------------------------------------- leaves

    await queryRunner.query(`
      CREATE TABLE "leaves" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "employee_id" integer NOT NULL,
        "type" "leaves_type_enum" NOT NULL,
        "from_date" date NOT NULL,
        "to_date" date NOT NULL,
        "days" integer NOT NULL,
        "reason" character varying(1000),
        "status" "leaves_status_enum" NOT NULL DEFAULT 'REQUESTED',
        "approved_by_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_leaves_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_leaves_employee"
          FOREIGN KEY ("employee_id") REFERENCES "employees"("id"),
        CONSTRAINT "fk_leaves_approved_by"
          FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_leave_org" ON "leaves" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_leave_employee" ON "leaves" ("employee_id")`,
    );

    // ---------------------------------------------------------- payroll runs

    await queryRunner.query(`
      CREATE TABLE "payroll_runs" (
        "id" SERIAL PRIMARY KEY,
        "run_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "period" character varying NOT NULL,
        "status" "payroll_runs_status_enum" NOT NULL DEFAULT 'DRAFT',
        "created_by_id" integer,
        "paid_on" date,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_payroll_runs_run_number" UNIQUE ("run_number"),
        CONSTRAINT "fk_payroll_runs_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_payroll_runs_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_payroll_org" ON "payroll_runs" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payroll_period" ON "payroll_runs" ("period")`,
    );

    // ---------------------------------------------------------- payroll lines

    await queryRunner.query(`
      CREATE TABLE "payroll_lines" (
        "id" SERIAL PRIMARY KEY,
        "run_id" integer NOT NULL,
        "employee_id" integer NOT NULL,
        "payslip_number" character varying NOT NULL,
        "base_salary" numeric(14,2) NOT NULL DEFAULT '0',
        "allowances" numeric(14,2) NOT NULL DEFAULT '0',
        "deductions" numeric(14,2) NOT NULL DEFAULT '0',
        "overtime_hours" numeric(6,2) NOT NULL DEFAULT '0',
        "overtime_amount" numeric(14,2) NOT NULL DEFAULT '0',
        "gross" numeric(14,2) NOT NULL DEFAULT '0',
        "net" numeric(14,2) NOT NULL DEFAULT '0',
        CONSTRAINT "uk_payroll_lines_payslip_number" UNIQUE ("payslip_number"),
        CONSTRAINT "fk_payroll_lines_run"
          FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_payroll_lines_employee"
          FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_payroll_line_run" ON "payroll_lines" ("run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payroll_line_employee" ON "payroll_lines" ("employee_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payroll_lines"`);
    await queryRunner.query(`DROP TABLE "payroll_runs"`);
    await queryRunner.query(`DROP TABLE "leaves"`);
    await queryRunner.query(`DROP TABLE "attendance"`);
    await queryRunner.query(`DROP TABLE "employee_pay_items"`);
    await queryRunner.query(`DROP TABLE "employees"`);
    await queryRunner.query(`DROP TABLE "job_positions"`);
    await queryRunner.query(`DROP TABLE "departments"`);
    await queryRunner.query(`DROP TYPE "payroll_runs_status_enum"`);
    await queryRunner.query(`DROP TYPE "leaves_status_enum"`);
    await queryRunner.query(`DROP TYPE "leaves_type_enum"`);
    await queryRunner.query(`DROP TYPE "attendance_status_enum"`);
    await queryRunner.query(`DROP TYPE "employee_pay_items_type_enum"`);
    await queryRunner.query(`DROP TYPE "employees_status_enum"`);
  }
}
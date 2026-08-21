import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Finance management (technical proposal section 7): the general ledger.
 * Accounts and cost centres give the journal its rows; budgets give reports
 * something to compare against. Income, expenses, cash and balances are all
 * the same shape here - a balanced journal entry - so the reports (trial
 * balance, profit and loss, balance sheet) are sums over one table instead of
 * a parallel spreadsheet.
 */
export class Finance1756000000000 implements MigrationInterface {
  name = 'Finance1756000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- enums

    await queryRunner.query(`
      CREATE TYPE "accounts_type_enum" AS ENUM
        ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')
    `);

    // ------------------------------------------------------------- accounts

    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "type" "accounts_type_enum" NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_account_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_accounts_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_account_org" ON "accounts" ("organization_id")`,
    );

    // -------------------------------------------------------- cost centres

    await queryRunner.query(`
      CREATE TABLE "cost_centres" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_cost_centre_org_code" UNIQUE ("organization_id","code"),
        CONSTRAINT "fk_cost_centres_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_cost_centre_org" ON "cost_centres" ("organization_id")`,
    );

    // ------------------------------------------------------- journal entries

    await queryRunner.query(`
      CREATE TABLE "journal_entries" (
        "id" SERIAL PRIMARY KEY,
        "entry_number" character varying NOT NULL,
        "organization_id" integer NOT NULL,
        "description" character varying(1000) NOT NULL,
        "posted_on" date,
        "created_by_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uk_journal_entries_entry_number" UNIQUE ("entry_number"),
        CONSTRAINT "fk_journal_entries_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_journal_entries_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_journal_org" ON "journal_entries" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_journal_posted_on" ON "journal_entries" ("posted_on")`,
    );

    // ---------------------------------------------------------- journal lines

    await queryRunner.query(`
      CREATE TABLE "journal_lines" (
        "id" SERIAL PRIMARY KEY,
        "entry_id" integer NOT NULL,
        "account_id" integer NOT NULL,
        "cost_centre_id" integer,
        "debit" numeric(14,2) NOT NULL DEFAULT '0',
        "credit" numeric(14,2) NOT NULL DEFAULT '0',
        CONSTRAINT "fk_journal_lines_entry"
          FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_journal_lines_account"
          FOREIGN KEY ("account_id") REFERENCES "accounts"("id"),
        CONSTRAINT "fk_journal_lines_cost_centre"
          FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_journal_line_entry" ON "journal_lines" ("entry_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_journal_line_account" ON "journal_lines" ("account_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_journal_line_cost_centre" ON "journal_lines" ("cost_centre_id")`,
    );

    // --------------------------------------------------------------- budgets

    await queryRunner.query(`
      CREATE TABLE "budgets" (
        "id" SERIAL PRIMARY KEY,
        "organization_id" integer NOT NULL,
        "account_id" integer NOT NULL,
        "cost_centre_id" integer,
        "period" character varying NOT NULL,
        "amount" numeric(14,2) NOT NULL DEFAULT '0',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_budgets_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id"),
        CONSTRAINT "fk_budgets_account"
          FOREIGN KEY ("account_id") REFERENCES "accounts"("id"),
        CONSTRAINT "fk_budgets_cost_centre"
          FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_budget_org" ON "budgets" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_budget_account" ON "budgets" ("account_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_budget_cost_centre" ON "budgets" ("cost_centre_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "budgets"`);
    await queryRunner.query(`DROP TABLE "journal_lines"`);
    await queryRunner.query(`DROP TABLE "journal_entries"`);
    await queryRunner.query(`DROP TABLE "cost_centres"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
    await queryRunner.query(`DROP TYPE "accounts_type_enum"`);
  }
}
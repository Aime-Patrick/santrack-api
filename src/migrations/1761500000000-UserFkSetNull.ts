import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds ON DELETE SET NULL to every nullable user-reference FK that was
 * previously created without it.
 *
 * Without this, deleting a user row fails with a FK violation on any table
 * that still references that user as an audit-trail column (reviewed_by,
 * actor_id, created_by_id, etc.).
 *
 * All affected columns are nullable, so nulling them on delete is correct:
 * the record of what happened is preserved; only the pointer to the person
 * who is no longer on the platform is cleared.
 *
 * Strategy per column:
 *   1. Drop every existing FK on (table, column) by querying pg_constraint.
 *   2. Re-add a single FK with ON DELETE SET NULL under a stable name.
 */
export class UserFkSetNull1761500000000 implements MigrationInterface {
  name = 'UserFkSetNull1761500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const fixes: Array<{ table: string; column: string; name: string }> = [
      { table: 'licenses',                       column: 'reviewed_by_id',          name: 'fk_licenses_reviewed_by' },
      { table: 'license_documents',              column: 'uploaded_by_id',           name: 'fk_license_documents_uploaded_by' },
      { table: 'license_events',                 column: 'actor_id',                 name: 'fk_license_events_actor' },
      { table: 'public_complaints',              column: 'reviewed_by_id',           name: 'fk_public_complaints_reviewed_by' },
      { table: 'regulatory_cases',               column: 'assigned_to_id',           name: 'fk_regulatory_cases_assigned_to' },
      { table: 'regulatory_cases',               column: 'opened_by_id',             name: 'fk_regulatory_cases_opened_by' },
      { table: 'regulatory_case_referrals',      column: 'decided_by_id',            name: 'fk_case_referrals_decided_by' },
      { table: 'regulatory_case_events',         column: 'actor_id',                 name: 'fk_case_events_actor' },
      { table: 'registration_consultations',     column: 'responded_by_id',          name: 'fk_consultations_responded_by' },
      { table: 'purchase_orders',                column: 'created_by_id',            name: 'fk_purchase_orders_created_by' },
      { table: 'sales_orders',                   column: 'created_by_id',            name: 'fk_sales_orders_created_by' },
      { table: 'sales_orders',                   column: 'rounding_accepted_by_id',  name: 'fk_sales_orders_rounding_accepted_by' },
      { table: 'quotations',                     column: 'created_by_id',            name: 'fk_quotations_created_by' },
      { table: 'traceable_items',                column: 'cancelled_by_id',          name: 'fk_traceable_items_cancelled_by' },
      { table: 'identity_pools',                 column: 'created_by_id',            name: 'fk_identity_pools_created_by' },
      { table: 'production_eligibility_decisions', column: 'evaluated_by_id',        name: 'fk_eligibility_decisions_evaluated_by' },
      { table: 'transfers',                      column: 'dispatched_by_id',         name: 'fk_transfers_dispatched_by' },
      { table: 'transfers',                      column: 'received_by_id',           name: 'fk_transfers_received_by' },
      { table: 'traceability_events',            column: 'actor_id',                 name: 'fk_traceability_events_actor' },
      { table: 'compliance_findings',            column: 'actor_id',                 name: 'fk_compliance_findings_actor' },
      { table: 'audit_logs',                     column: 'actor_id',                 name: 'fk_audit_logs_actor' },
      { table: 'payroll_runs',                   column: 'created_by_id',            name: 'fk_payroll_runs_created_by' },
      { table: 'leaves',                         column: 'approved_by_id',           name: 'fk_leaves_approved_by' },
      { table: 'journal_entries',                column: 'created_by_id',            name: 'fk_journal_entries_created_by' },
      { table: 'sales_returns',                  column: 'created_by_id',            name: 'fk_sales_returns_created_by' },
      { table: 'payments',                       column: 'received_by_id',           name: 'fk_payments_received_by' },
      { table: 'invoices',                       column: 'created_by_id',            name: 'fk_invoices_created_by' },
      { table: 'shipments',                      column: 'created_by_id',            name: 'fk_shipments_created_by' },
      { table: 'shipment_events',                column: 'actor_id',                 name: 'fk_shipment_events_actor' },
      { table: 'sales',                          column: 'sold_by_id',               name: 'fk_sales_sold_by' },
      { table: 'production_events',              column: 'actor_id',                 name: 'fk_production_events_actor' },
    ];

    for (const { table, column, name } of fixes) {
      // Drop all existing FKs on this (table, column) pair so we don't leave
      // a dangling unnamed TypeORM-generated constraint alongside our new one.
      await queryRunner.query(`
        DO $$
        DECLARE r TEXT;
        BEGIN
          FOR r IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class t   ON t.oid = c.conrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
            WHERE t.relname = '${table}'
              AND a.attname = '${column}'
              AND c.contype = 'f'
          LOOP
            EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS %I', r);
          END LOOP;
        END $$;
      `);

      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${name}"
          FOREIGN KEY ("${column}") REFERENCES "users"("id") ON DELETE SET NULL
      `);
    }
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Rolling back to FKs without ON DELETE SET NULL would re-introduce the
    // crash. Down migration is intentionally a no-op.
  }
}

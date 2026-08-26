/**
 * One-off repair: production lots that were created ACTIVE (the old default)
 * and never inspected, but have not yet been shipped or sold.
 *
 * Those lots could be confirmed and dispatched without QC. New production
 * creates them as PENDING_QC instead. This script flips the leftover ACTIVE
 * production lots back to PENDING_QC so they cannot ship until approved.
 *
 * Lots that already have DISPATCHED or SOLD events are left alone — those
 * need a recall, not a quiet status rewrite.
 *
 * Dry-run by default:
 *   npx ts-node -T scripts/repair-uninspected-production-lots.ts
 *   npx ts-node -T scripts/repair-uninspected-production-lots.ts --apply
 */
import 'reflect-metadata';
import dataSource from '../src/config/data-source';

async function main() {
  const apply = process.argv.includes('--apply');
  await dataSource.initialize();

  const rows: { id: number; batch_code: string; order_number: string }[] =
    await dataSource.query(`
      SELECT b.id, b.batch_code, po.order_number
      FROM batches b
      INNER JOIN production_orders po ON po.batch_id = b.id
      WHERE b.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1
          FROM traceability_events e
          INNER JOIN traceable_items i ON i.id = e.item_id
          WHERE i.batch_id = b.id
            AND e.type IN ('DISPATCHED', 'SOLD')
        )
      ORDER BY b.id
    `);

  if (rows.length === 0) {
    console.log('No unshipped ACTIVE production lots to repair.');
    await dataSource.destroy();
    return;
  }

  console.log(
    apply
      ? `Applying PENDING_QC to ${rows.length} lot(s):`
      : `Would set PENDING_QC on ${rows.length} lot(s) (dry-run; pass --apply):`,
  );
  for (const row of rows) {
    console.log(`  ${row.batch_code} (order ${row.order_number})`);
  }

  if (apply) {
    await dataSource.query(
      `
      UPDATE batches b
      SET
        previous_status = b.status,
        status = 'PENDING_QC',
        status_reason = 'Repaired: production lot must await QC before trade',
        status_changed_at = now()
      WHERE b.id = ANY($1::int[])
      `,
      [rows.map((r) => r.id)],
    );
    console.log('Done.');
  }

  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

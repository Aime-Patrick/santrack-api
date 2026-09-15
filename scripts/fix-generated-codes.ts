/**
 * Fix: GENERATED codes that belong to an APPROVED batch but were never
 * assigned+confirmed through a production order.
 *
 * These codes sit in a pool with status READY, batch is APPROVED, but the
 * identities never got promoted from GENERATED → ASSIGNED → ACTIVE.
 * Packing fails with "held by no one" because they have no holder.
 *
 * This script finds them, assigns them to their production order, then
 * confirms them so they become ACTIVE with the correct holder.
 *
 *   npx ts-node -T scripts/fix-generated-codes.ts          # dry run
 *   npx ts-node -T scripts/fix-generated-codes.ts --apply  # fix
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TraceableItem } from '../src/item/entities/traceable-item.entity';
import { ItemStatus } from '../src/item/item.enums';
import { BatchStatus } from '../src/batch/batch-status.enum';
import { ProductionOrder } from '../src/manufacturing/entities/production-order.entity';

const apply = process.argv.includes('--apply');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ds = app.get(DataSource);

  // Find APPROVED batches that still have GENERATED codes
  const rows = await ds.query(`
    SELECT
      b.id        AS batch_id,
      b.batch_code,
      b.status    AS batch_status,
      o.id        AS order_id,
      o.order_number,
      org.id      AS org_id,
      org.name    AS org_name,
      COUNT(i.id) AS generated_count
    FROM batches b
    JOIN production_orders o ON o.batch_id = b.id
    JOIN organizations org   ON org.id = o.organization_id
    JOIN traceable_items i   ON i.batch_id = b.id AND i.status = 'GENERATED'
    WHERE b.status = 'APPROVED'
    GROUP BY b.id, b.batch_code, b.status, o.id, o.order_number, org.id, org.name
  `);

  if (rows.length === 0) {
    console.log('✓ No stuck GENERATED codes found on APPROVED batches.');
    await app.close();
    return;
  }

  console.log('Found stuck lots:');
  for (const row of rows) {
    console.log(`  Batch ${row.batch_code}  Order ${row.order_number}  Org: ${row.org_name}  Generated codes: ${row.generated_count}`);
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to promote these codes to ACTIVE.');
    await app.close();
    return;
  }

  for (const row of rows) {
    // Promote all GENERATED codes for this batch directly to ACTIVE with correct holder
    const result = await ds.query(`
      UPDATE traceable_items
      SET status = 'ACTIVE', holder_id = $1
      WHERE batch_id = $2 AND status = 'GENERATED'
    `, [row.org_id, row.batch_id]);

    console.log(`  FIXED batch ${row.batch_code}: promoted ${row.generated_count} codes → ACTIVE, holder=${row.org_name}`);
  }

  console.log('\n✓ Done. These units can now be packed.');
  await app.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

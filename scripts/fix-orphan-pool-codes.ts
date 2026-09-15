/**
 * Fix orphan GENERATED codes that have no batch_id.
 *
 * These were minted from a pool but never assigned to a production order,
 * so batch_id = null and holder_id = null. They cannot be packed.
 *
 * This script links them to the APPROVED batch for the same product and
 * promotes them to ACTIVE so they can be used.
 *
 *   npx ts-node -T scripts/fix-orphan-pool-codes.ts          # dry run
 *   npx ts-node -T scripts/fix-orphan-pool-codes.ts --apply  # fix
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const apply = process.argv.includes('--apply');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ds = app.get(DataSource);

  // Find orphan GENERATED codes (no batch_id) and match them to an APPROVED
  // batch for the same product via the pool → product link.
  const orphans = await ds.query(`
    SELECT
      i.id          AS item_id,
      i.code,
      i.product_id,
      p.name        AS product_name,
      b.id          AS batch_id,
      b.batch_code,
      org.id        AS org_id,
      org.name      AS org_name
    FROM traceable_items i
    JOIN products p       ON p.id = i.product_id
    JOIN batches b        ON b.product_id = p.id AND b.status = 'APPROVED'
    JOIN production_orders o ON o.batch_id = b.id
    JOIN organizations org   ON org.id = o.organization_id
    WHERE i.status = 'GENERATED'
      AND i.batch_id IS NULL
    ORDER BY i.id
  `);

  if (orphans.length === 0) {
    console.log('✓ No orphan GENERATED codes found. Nothing to do.');
    await app.close();
    return;
  }

  // Group by product for summary
  const byProduct: Record<string, typeof orphans> = {};
  for (const row of orphans) {
    const key = `${row.product_name} → batch ${row.batch_code} (org: ${row.org_name})`;
    byProduct[key] = byProduct[key] ?? [];
    byProduct[key].push(row);
  }

  console.log('Orphan codes found:');
  for (const [key, rows] of Object.entries(byProduct)) {
    console.log(`  ${rows.length} codes  →  ${key}`);
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to link and activate these codes.');
    await app.close();
    return;
  }

  for (const row of orphans) {
    await ds.query(`
      UPDATE traceable_items
      SET status    = 'ACTIVE',
          batch_id  = $1,
          holder_id = $2
      WHERE id = $3
    `, [row.batch_id, row.org_id, row.item_id]);
  }

  console.log(`\n✓ Fixed ${orphans.length} codes — now ACTIVE with correct batch and holder.`);
  console.log('These units can now be packed into the registered package.');
  await app.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

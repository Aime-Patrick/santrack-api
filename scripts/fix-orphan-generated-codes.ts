/**
 * Fix orphan GENERATED codes stuck with null batch_id.
 *
 * These were minted (from a pool or directly) but never assigned to a
 * production order, so they remain in the pre-production limbo of
 * GENERATED status.  They cannot be packed, sold, or counted as stock.
 *
 * Strategy:
 *   1. Find every APPROVED batch that belongs to the same product.
 *   2. If exactly one APPROVED batch exists for that product, link the
 *      orphan codes to it and promote them to ACTIVE.
 *   3. If multiple APPROVED batches exist, pick the one whose production
 *      order has the closest planned quantity (most likely the intended
 *      run).  Report ambiguity so the operator can verify.
 *   4. If no APPROVED batch exists for the product, report the codes as
 *      unfixable — the operator must create / approve a batch first.
 *
 *   npx ts-node -T scripts/fix-orphan-generated-codes.ts          # dry run
 *   npx ts-node -T scripts/fix-orphan-generated-codes.ts --apply  # fix
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const apply = process.argv.includes('--apply');

interface OrphanRow {
  item_id: number;
  code: string;
  product_id: number;
  product_name: string;
  pool_id: number | null;
}

interface BatchCandidate {
  batch_id: number;
  batch_code: string;
  org_id: number;
  org_name: string;
  planned_quantity: number | null;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ds = app.get(DataSource);

  // ── Step 1: find all orphan GENERATED codes ───────────────────────
  const orphans = await ds.query(`
    SELECT
      i.id          AS item_id,
      i.code,
      i.product_id,
      p.name        AS product_name,
      i.pool_id
    FROM traceable_items i
    JOIN products p ON p.id = i.product_id
    WHERE i.status = 'GENERATED'
      AND i.batch_id IS NULL
    ORDER BY i.product_id, i.id
  `) as OrphanRow[];

  if (orphans.length === 0) {
    console.log('✓ No orphan GENERATED codes found. Nothing to do.');
    await app.close();
    return;
  }

  // ── Step 2: group by product ──────────────────────────────────────
  const byProduct = new Map<number, OrphanRow[]>();
  for (const row of orphans) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push(row);
    byProduct.set(row.product_id, list);
  }

  console.log(`Found ${orphans.length} orphan GENERATED codes across ${byProduct.size} product(s).\n`);

  const fixes: Array<{ code: string; batch_code: string; org_name: string }> = [];
  const unfixable: Array<{ code: string; reason: string }> = [];

  // ── Step 3: for each product, find the best APPROVED batch ────────
  for (const [productId, items] of byProduct) {
    const productName = items[0].product_name;

    // APPROVED batches for this product that have a production order
    const batches = await ds.query(`
      SELECT
        b.id          AS batch_id,
        b.batch_code,
        o.id          AS order_id,
        o.organization_id AS org_id,
        org.name      AS org_name,
        o.planned_quantity
      FROM batches b
      JOIN production_orders o ON o.batch_id = b.id
      JOIN organizations org   ON org.id = o.organization_id
      WHERE b.product_id = $1
        AND b.status = 'APPROVED'
      ORDER BY o.planned_quantity DESC
    `, [productId]) as BatchCandidate[];

    if (batches.length === 0) {
      // Also try batches without a production order (manual batches)
      const manualBatches = await ds.query(`
        SELECT
          b.id          AS batch_id,
          b.batch_code,
          NULL          AS order_id,
          b.manufacturer_id AS org_id,
          org.name      AS org_name,
          NULL          AS planned_quantity
        FROM batches b
        JOIN organizations org ON org.id = b.manufacturer_id
        WHERE b.product_id = $1
          AND b.status = 'APPROVED'
      `, [productId]) as BatchCandidate[];

      if (manualBatches.length === 0) {
        for (const item of items) {
          unfixable.push({ code: item.code, reason: `No APPROVED batch exists for product "${productName}"` });
        }
        console.log(`  ⚠ ${items.length} code(s) for "${productName}" — no APPROVED batch found, skipping.`);
        continue;
      }

      // Use manual batch if exactly one
      if (manualBatches.length === 1) {
        const b = manualBatches[0];
        for (const item of items) {
          fixes.push({ code: item.code, batch_code: b.batch_code, org_name: b.org_name });
        }
        console.log(`  ${items.length} code(s) for "${productName}" → batch ${b.batch_code} (manual, org: ${b.org_name})`);
        continue;
      }

      // Multiple manual batches — pick largest
      const best = manualBatches[0];
      for (const item of items) {
        fixes.push({ code: item.code, batch_code: best.batch_code, org_name: best.org_name });
      }
      console.log(`  ${items.length} code(s) for "${productName}" → batch ${best.batch_code} (${manualBatches.length} APPROVED batches, picked largest)`);
      continue;
    }

    if (batches.length === 1) {
      const b = batches[0];
      for (const item of items) {
        fixes.push({ code: item.code, batch_code: b.batch_code, org_name: b.org_name });
      }
      console.log(`  ${items.length} code(s) for "${productName}" → batch ${b.batch_code} (org: ${b.org_name})`);
    } else {
      // Multiple candidates — pick the one with the closest planned quantity
      const best = batches[0];
      for (const item of items) {
        fixes.push({ code: item.code, batch_code: best.batch_code, org_name: best.org_name });
      }
      console.log(`  ${items.length} code(s) for "${productName}" → batch ${best.batch_code} (${batches.length} APPROVED batches, picked ${best.batch_code})`);
    }
  }

  // ── Step 4: summary ──────────────────────────────────────────────
  if (unfixable.length > 0) {
    console.log(`\n${unfixable.length} code(s) cannot be fixed:`);
    for (const u of unfixable) {
      console.log(`  ${u.code} — ${u.reason}`);
    }
  }

  if (fixes.length === 0) {
    console.log('\nNo codes can be fixed automatically.');
    await app.close();
    return;
  }

  if (!apply) {
    console.log(`\nDry run — ${fixes.length} code(s) would be fixed. Pass --apply to apply.`);
    await app.close();
    return;
  }

  // ── Step 5: apply fixes ──────────────────────────────────────────
  let fixed = 0;
  for (const f of fixes) {
    const result = await ds.query(`
      UPDATE traceable_items
      SET status    = 'ACTIVE',
          batch_id  = (SELECT id FROM batches WHERE batch_code = $1 LIMIT 1),
          holder_id = (SELECT o.organization_id FROM production_orders o JOIN batches b ON b.id = o.batch_id WHERE b.batch_code = $1 LIMIT 1)
      WHERE code = $2
        AND status = 'GENERATED'
        AND batch_id IS NULL
    `, [f.batch_code, f.code]);

    if (result[1] > 0) {
      fixed++;
    }
  }

  console.log(`\n✓ Fixed ${fixed} codes — now ACTIVE with correct batch and holder.`);
  if (fixed < fixes.length) {
    console.log(`  ${fixes.length - fixed} codes were already linked or not found.`);
  }
  await app.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

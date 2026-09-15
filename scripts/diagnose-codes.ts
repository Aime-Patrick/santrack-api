import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ds = app.get(DataSource);

  // All GENERATED codes and their batch/order context
  const rows = await ds.query(`
    SELECT
      i.code,
      i.status      AS item_status,
      i.holder_id,
      b.batch_code,
      b.status      AS batch_status,
      o.order_number,
      o.status      AS order_status
    FROM traceable_items i
    LEFT JOIN batches b            ON b.id = i.batch_id
    LEFT JOIN production_orders o  ON o.batch_id = b.id
    WHERE i.status = 'GENERATED'
    LIMIT 20
  `);

  if (rows.length === 0) {
    console.log('No GENERATED codes found at all.');
  } else {
    console.log('GENERATED codes:');
    console.table(rows);
  }

  // Also check what batch the marker product has
  const batches = await ds.query(`
    SELECT b.id, b.batch_code, b.status, p.name AS product_name
    FROM batches b
    JOIN products p ON p.id = b.product_id
    WHERE p.name ILIKE '%marker%'
  `);
  console.log('\nBatches for marker:');
  console.table(batches);

  await app.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

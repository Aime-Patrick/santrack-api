/**
 * One-off repair for units stranded in ASSIGNED status.
 *
 * Before the pipeline page fix, "Finish run" only called completeProduction
 * and skipped confirmProduced + closeProduction. Any production order completed
 * that way left its identity codes in ASSIGNED status with no holder — making
 * them invisible to pack operations and throwing "held by no one".
 *
 * This finds every ASSIGNED item whose batch is APPROVED (i.e. production is
 * done and QC passed) and promotes them to ACTIVE under their batch's
 * manufacturer organization.
 *
 *   npx ts-node -T scripts/repair-stranded-assigned-units.ts          # dry run
 *   npx ts-node -T scripts/repair-stranded-assigned-units.ts --apply  # fix
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { TraceableItem } from '../src/item/entities/traceable-item.entity';
import { ItemStatus } from '../src/item/item.enums';
import { BatchStatus } from '../src/batch/batch-status.enum';

const apply = process.argv.includes('--apply');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ds = app.get(DataSource);

  // Find all ASSIGNED items whose batch is APPROVED
  const stranded = await ds.manager
    .createQueryBuilder(TraceableItem, 'item')
    .innerJoinAndSelect('item.batch', 'batch')
    .innerJoinAndSelect('batch.manufacturer', 'org')
    .where('item.status = :status', { status: ItemStatus.ASSIGNED })
    .andWhere('batch.status = :batchStatus', { batchStatus: BatchStatus.APPROVED })
    .getMany();

  if (stranded.length === 0) {
    console.log('✓ No stranded ASSIGNED units found. Nothing to do.');
    await app.close();
    return;
  }

  console.log(`Found ${stranded.length} stranded unit(s):`);
  for (const item of stranded) {
    console.log(
      `  ${item.code}  batch=${item.batch?.batchCode}  org=${item.batch?.manufacturer?.name ?? 'unknown'}`,
    );
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to fix these units.');
    await app.close();
    return;
  }

  // Promote each unit: ASSIGNED → ACTIVE, set holder to the batch's manufacturer
  for (const item of stranded) {
    const org = item.batch?.manufacturer;
    if (!org) {
      console.warn(`  SKIP ${item.code} — batch has no manufacturer, cannot assign holder`);
      continue;
    }
    await ds.manager.update(TraceableItem, item.id, {
      status: ItemStatus.ACTIVE,
      holder: { id: org.id },
    });
    console.log(`  FIXED ${item.code} → ACTIVE, holder=${org.name}`);
  }

  console.log(`\n✓ Repaired ${stranded.length} unit(s).`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

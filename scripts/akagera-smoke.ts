/**
 * Walks the Akagera Water 500ml run end to end against the dev database.
 *
 * Not part of the test suite - that is unit-only by design so it can gate CI
 * with no database. This exists so the scenario the identity lifecycle was
 * built for can be read as numbers rather than reasoned about:
 *
 *   10,000 codes prepared     ->  stock page still says 0
 *   assigned to a run         ->  stock page still says 0
 *   100 broken + 50 unused    ->  cancelled, with reasons, never deleted
 *   production confirmed      ->  9,850 bottles appear in stock
 *
 *   npx ts-node -T scripts/akagera-smoke.ts [count]
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { User } from '../src/auth/entities/user.entity';
import { Batch } from '../src/batch/entities/batch.entity';
import { BatchStatus } from '../src/batch/batch-status.enum';
import { InventoryService } from '../src/inventory/services/inventory.service';
import { IdentityPoolService } from '../src/item/services/identity-pool.service';
import { PoolStatus } from '../src/item/entities/identity-pool.entity';
import { TraceableItem } from '../src/item/entities/traceable-item.entity';
import { CancellationReason, ItemStatus } from '../src/item/item.enums';
import { ProductionService } from '../src/manufacturing/services/production.service';
import { Organization } from '../src/organization/entities/organization.entity';
import { Product } from '../src/product/entities/product.entity';
import { TraceabilityLevel } from '../src/product/traceability-level.enum';
import { TraceabilityEvent } from '../src/traceability/entities/traceability-event.entity';

const COUNT = Number(process.argv[2] ?? 10_000);
const DEFECTS = Math.min(100, Math.floor(COUNT / 100));
const UNUSED = Math.min(50, Math.floor(COUNT / 200));

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${String(actual)}` +
      (ok ? '' : `   (expected ${String(expected)})`),
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  const db = app.get(DataSource);
  const pools = app.get(IdentityPoolService);
  const inventory = app.get(InventoryService);
  const production = app.get(ProductionService);

  const org = await db.getRepository(Organization).findOneOrFail({
    where: { type: 'MANUFACTURER' as never },
    order: { id: 'ASC' },
  });
  const actor = await db
    .getRepository(User)
    .findOneOrFail({ where: {}, order: { id: 'ASC' } });

  // ---------------------------------------------------------------- act 1
  console.log(`\n=== ACT 1 — catalogue ====================================`);
  const product = await db.getRepository(Product).save(
    db.getRepository(Product).create({
      organizationId: org.id,
      name: 'Akagera Water 500ml',
      sku: `AKAG-W500-${Date.now()}`,
      traceabilityLevel: TraceabilityLevel.SERIAL,
    }),
  );
  console.log(`product #${product.id}  ${product.name}  sku=${product.sku}`);
  check('stock before anything', await stock(), 0);

  // ---------------------------------------------------------------- act 2
  console.log(`\n=== ACT 2 — generate ${COUNT} identities ==================`);
  const started = Date.now();
  const pool = await pools.request(org, actor, {
    productId: product.id,
    count: COUNT,
  });
  while ((await pools.requirePool(pool.id)).status === PoolStatus.GENERATING) {
    await new Promise((r) => setTimeout(r, 150));
  }
  const filled = await pools.requirePool(pool.id);
  console.log(`pool #${pool.id}  ${filled.status} in ${Date.now() - started}ms`);
  check('identities minted', await pools.mintedCount(pool.id), COUNT);
  check('*** stock page still says ***', await stock(), 0);

  // ---------------------------------------------------------------- act 3
  console.log(`\n=== ACT 3 — assign the pool to a production run ===========`);
  const order = await production.create(org, actor, {
    productId: product.id,
    plannedQuantity: COUNT,
  });
  const assignment = await pools.assign(org, actor, {
    poolId: pool.id,
    productionOrderId: order.id,
  });
  console.log(
    `order ${assignment.orderNumber}  claimed ${assignment.assigned} codes  ` +
      `${assignment.firstCode} .. ${assignment.lastCode}`,
  );
  check('codes assigned', assignment.assigned, COUNT);
  check('*** stock page still says ***', await stock(), 0);

  // ------------------------------------------------------------ acts 5, 6
  // Cancelled before confirmation, which is the real order of events: the
  // operator scans each failure as it happens, all shift.
  console.log(`\n=== ACTS 5 & 6 — cancel what failed ======================`);
  const assigned = await db.getRepository(TraceableItem).find({
    where: { pool: { id: pool.id }, status: ItemStatus.ASSIGNED },
    order: { id: 'ASC' },
    take: DEFECTS + UNUSED,
  });

  const broken = await pools.cancel(
    org,
    actor,
    assigned.slice(0, DEFECTS).map((i) => i.code),
    { reason: CancellationReason.PRODUCTION_DEFECT, notes: 'Broke on the line' },
  );
  const wasted = await pools.cancel(
    org,
    actor,
    assigned.slice(DEFECTS).map((i) => i.code),
    { reason: CancellationReason.LABEL_UNUSED },
  );
  console.log(`cancelled ${broken.cancelled} defective, ${wasted.cancelled} unused`);
  check('defective cancelled', broken.cancelled, DEFECTS);
  check('unused cancelled', wasted.cancelled, UNUSED);
  check('*** stock page still says ***', await stock(), 0);

  // A cancelled code must refuse to be cancelled twice, and must refuse to
  // become a product later. Nothing quietly resurrects.
  const doubleCancel = await pools
    .cancel(org, actor, [assigned[0].code], {
      reason: CancellationReason.OTHER,
    })
    .then(() => 'allowed')
    .catch(() => 'refused');
  check('cancelling an already-cancelled code', doubleCancel, 'refused');

  // ---------------------------------------------------------------- act 4
  console.log(`\n=== ACT 4 — confirm production ===========================`);
  // QC has to have approved the lot before a code may mean a saleable bottle.
  const batch = await db
    .getRepository(Batch)
    .findOneOrFail({ where: { id: order.batch!.id } });
  batch.status = BatchStatus.APPROVED;
  await db.getRepository(Batch).save(batch);

  const confirmation = await pools.confirmProduced(org, actor, {
    productionOrderId: order.id,
  });
  console.log(
    `confirmed ${confirmation.confirmed} on ${confirmation.orderNumber}, ` +
      `${confirmation.stillAwaitingProduction} still awaiting`,
  );

  const expected = COUNT - DEFECTS - UNUSED;
  check('confirmed as produced', confirmation.confirmed, expected);
  check('*** stock page NOW says ***', await stock(), expected);

  const reloaded = await production.get(org, order.id);
  check('order producedQuantity (derived)', reloaded.producedQuantity, expected);

  // ------------------------------------------------------------ the trail
  console.log(`\n=== AUDIT TRAIL ==========================================`);
  const sample = assigned[0];
  const history = await db.getRepository(TraceabilityEvent).find({
    where: { item: { id: sample.id } },
    order: { id: 'ASC' },
  });
  console.log(`  ${sample.code} (cancelled):`);
  for (const e of history) console.log(`    ${e.type}`);

  const survivor = await db.getRepository(TraceableItem).findOneOrFail({
    where: { pool: { id: pool.id }, status: ItemStatus.ACTIVE },
    order: { id: 'DESC' },
  });
  const survivorHistory = await db.getRepository(TraceabilityEvent).find({
    where: { item: { id: survivor.id } },
    order: { id: 'ASC' },
  });
  console.log(`  ${survivor.code} (in stock):`);
  for (const e of survivorHistory) console.log(`    ${e.type}`);

  const cancelledRow = await db
    .getRepository(TraceableItem)
    .findOneOrFail({ where: { id: sample.id } });
  check('cancelled row still exists', cancelledRow.status, ItemStatus.CANCELLED);
  check(
    'cancelled row carries its reason',
    cancelledRow.cancellationReason,
    CancellationReason.PRODUCTION_DEFECT,
  );

  // -------------------------------------------------------- reconciliation
  console.log(`\n=== RECONCILIATION =======================================`);
  const r = await pools.reconcile(pool.id);
  console.log(`  Generated              ${r.minted}`);
  console.log(`    in stock (ACTIVE)    ${r.produced}`);
  console.log(`    cancelled            ${r.cancelled}`);
  console.log(`    awaiting production  ${r.awaitingProduction}`);
  console.log(`    unminted             ${r.unminted}`);
  check(
    'balances: minted = produced + cancelled + awaiting',
    r.produced + r.cancelled + r.awaitingProduction,
    r.minted,
  );

  console.log(
    failures === 0
      ? `\nALL CHECKS PASSED\n`
      : `\n${failures} CHECK(S) FAILED\n`,
  );

  await app.close();
  process.exit(failures === 0 ? 0 : 1);

  /** Units the stock page reports for this product. */
  async function stock(): Promise<number> {
    const positions = await inventory.positions(org, undefined);
    return positions
      .filter((p) => p.productId === product.id)
      .reduce((n, p) => n + p.availableUnits, 0);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

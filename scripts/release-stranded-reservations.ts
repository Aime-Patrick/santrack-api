/**
 * One-off repair for stock stranded by DR-09 WU-6.
 *
 * Before WU-6, `SalesOrderService.cancel()` set the order status and touched
 * nothing else. The identities it had reserved stayed RESERVED for ever, and
 * every route out of that state refuses it — `blocksSale` excludes RESERVED,
 * and `TransferService.dispatch` and `relocate` both refuse it by name. Any
 * order cancelled before WU-6 shipped is still holding real goods hostage.
 *
 * This finds them and lets them go. It is required, not optional: the fix in
 * `cancel()` only helps orders cancelled from now on.
 *
 *   npx ts-node -T scripts/release-stranded-reservations.ts          # dry run
 *   npx ts-node -T scripts/release-stranded-reservations.ts --apply  # release
 *
 * Dry run by default, because the point of a data repair script is that you
 * get to read what it intends to do before it does it.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager, In } from 'typeorm';

import { AppModule } from '../src/app.module';
import { SalesOrderStatus } from '../src/commerce/commerce.enums';
import { SalesOrder } from '../src/commerce/entities/sales-order.entity';
import { SalesOrderReservation } from '../src/commerce/entities/sales-order-reservation.entity';
import { TraceableItem } from '../src/item/entities/traceable-item.entity';
import { ItemStatus } from '../src/item/item.enums';
import { EventType } from '../src/traceability/event-type.enum';
import { EventRecorder } from '../src/traceability/services/event-recorder.service';

const APPLY = process.argv.includes('--apply');

/** A live order still has a legitimate claim on its stock. */
const LIVE_ORDER_STATUSES = [SalesOrderStatus.PLACED, SalesOrderStatus.CONFIRMED];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  const db = app.get(DataSource);
  const recorder = app.get(EventRecorder);

  // Every reservation row belonging to a cancelled order whose identity is
  // still sitting in RESERVED.
  const suspects = await db
    .getRepository(SalesOrderReservation)
    .createQueryBuilder('r')
    .innerJoin(SalesOrder, 'o', 'o.id = r.order_id')
    .innerJoin(TraceableItem, 'i', 'i.id = r.item_id')
    .select('r.id', 'reservationId')
    .addSelect('r.item_id', 'itemId')
    .addSelect('r.quantity', 'quantity')
    .addSelect('o.id', 'orderId')
    .addSelect('o.order_number', 'orderNumber')
    .addSelect('o.organization_id', 'organizationId')
    .addSelect('i.code', 'itemCode')
    .where('o.status = :cancelled', { cancelled: SalesOrderStatus.CANCELLED })
    .andWhere('i.status = :reserved', { reserved: ItemStatus.RESERVED })
    .orderBy('o.id', 'ASC')
    .addOrderBy('r.id', 'ASC')
    .getRawMany<{
      reservationId: number;
      itemId: number;
      quantity: number;
      orderId: number;
      orderNumber: string;
      organizationId: number;
      itemCode: string;
    }>();

  if (suspects.length === 0) {
    console.log('\nNo stranded reservations. Nothing to do.\n');
    await app.close();
    return;
  }

  // An identity could in principle also be claimed by a live order. That
  // claim wins: a live order is entitled to hold its stock, and releasing it
  // here would quietly un-reserve goods somebody is about to dispatch.
  const itemIds = [...new Set(suspects.map((s) => s.itemId))];
  const claimed = await db
    .getRepository(SalesOrderReservation)
    .createQueryBuilder('r')
    .innerJoin(SalesOrder, 'o', 'o.id = r.order_id')
    .select('r.item_id', 'itemId')
    .where('r.item_id IN (:...itemIds)', { itemIds })
    .andWhere('o.status IN (:...live)', { live: LIVE_ORDER_STATUSES })
    .getRawMany<{ itemId: number }>();

  const stillClaimed = new Set(claimed.map((c) => c.itemId));
  const stranded = suspects.filter((s) => !stillClaimed.has(s.itemId));
  const skipped = suspects.length - stranded.length;

  const byOrder = new Map<string, typeof stranded>();
  for (const row of stranded) {
    const list = byOrder.get(row.orderNumber) ?? [];
    list.push(row);
    byOrder.set(row.orderNumber, list);
  }

  console.log(
    `\n${APPLY ? 'RELEASING' : 'DRY RUN — would release'} ` +
      `${stranded.length} identit${stranded.length === 1 ? 'y' : 'ies'} ` +
      `across ${byOrder.size} cancelled order(s).`,
  );
  if (skipped > 0) {
    console.log(
      `${skipped} left alone — also reserved by a live order, which keeps its claim.`,
    );
  }
  console.log();

  for (const [orderNumber, rows] of byOrder) {
    const sample = rows
      .slice(0, 5)
      .map((r) => r.itemCode)
      .join(', ');
    const more = rows.length > 5 ? `, +${rows.length - 5} more` : '';
    console.log(`  ${orderNumber.padEnd(14)} ${String(rows.length).padStart(6)}  ${sample}${more}`);
  }

  if (!APPLY) {
    console.log('\nRe-run with --apply to release them.\n');
    await app.close();
    return;
  }

  // Chunked so a large repair does not build one unbounded transaction, and
  // so a failure part way through leaves earlier chunks already correct.
  const CHUNK = 500;
  let released = 0;

  for (let i = 0; i < stranded.length; i += CHUNK) {
    const chunk = stranded.slice(i, i + CHUNK);

    await db.transaction(async (manager: EntityManager) => {
      const items = await manager.find(TraceableItem, {
        where: { id: In(chunk.map((c) => c.itemId)) },
      });
      const byId = new Map(items.map((item) => [item.id, item]));

      for (const row of chunk) {
        const item = byId.get(row.itemId);
        // Re-checked inside the transaction: the world may have moved between
        // the survey above and this write.
        if (!item || item.status !== ItemStatus.RESERVED) continue;

        item.status = ItemStatus.ACTIVE;
        await manager.save(TraceableItem, item);

        await recorder.record(manager, {
          item,
          type: EventType.RELEASED,
          actor: null,
          quantity: row.quantity,
          notes: `Reservation for ${row.orderNumber} cancelled (reconciled, DR-09 WU-6)`,
        });

        released++;
      }
    });

    console.log(`  ... ${Math.min(i + CHUNK, stranded.length)}/${stranded.length}`);
  }

  console.log(`\nReleased ${released}. Reservation rows left in place (invariant 9).\n`);
  await app.close();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

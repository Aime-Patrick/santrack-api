import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { permitsTrade } from '../../batch/batch-status.enum';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { TraceableItem, today } from '../../item/entities/traceable-item.entity';
import { ItemStatus, blocksSale } from '../../item/item.enums';
import {
  ItemService,
  requireHeldBy,
  requireOwnedLocation,
} from '../../item/services/item.service';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import {
  salesUnitPermitted,
  sellableUnits,
} from '../../product/sales-unit';
import { requestedProductUnits } from '../../commerce/sales-line';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { TransferService, nextReference } from '../../transfer/services/transfer.service';
import { SellDto, SellQuantityLineDto } from '../dto/sale.dto';
import { Sale, SaleLine, SaleType } from '../entities/sale.entity';

/**
 * Sells whole containers or individual units, either onward to another
 * business or out of the trade to a final consumer.
 *
 * A business sale also raises a dispatch, so the buyer confirms receipt
 * through the same two-party flow as any other handover. A consumer sale ends
 * the chain: the goods stop being sellable stock and the identity records who
 * took it, subject to the privacy rules.
 */
@Injectable()
export class SaleService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Sale)
    private readonly sales: Repository<Sale>,
    @InjectRepository(SaleLine)
    private readonly saleLines: Repository<SaleLine>,
    private readonly itemService: ItemService,
    private readonly transferService: TransferService,
    private readonly recorder: EventRecorder,
  ) {}

  async sell(
    seller: Organization,
    actor: User,
    dto: SellDto,
  ): Promise<{ sale: Sale; lines: SaleLine[] }> {
    await this.recorder.rejectReplay(dto.meta);

    const sale = await this.dataSource.transaction(async (manager) => {
      let buyer: Organization | null = null;
      if (dto.type === SaleType.BUSINESS) {
        if (!dto.buyerOrganizationId) {
          throw new TraceabilityRuleException(
            'A business sale needs a buyer organization',
          );
        }
        buyer = await manager.findOne(Organization, {
          where: { id: dto.buyerOrganizationId },
        });
        if (!buyer) {
          throw new NotFoundEntityException('Organization', dto.buyerOrganizationId);
        }
      } else if (!dto.consumerRef || dto.consumerRef.trim().length === 0) {
        throw new TraceabilityRuleException(
          'A consumer sale needs a consumer reference to anchor the final holder',
        );
      }

      const sellerLocation = dto.sellerLocationId
        ? await requireOwnedLocation(manager, seller, dto.sellerLocationId)
        : null;

      const scannedCodes = dto.itemQrCodes ?? [];
      const quantityCodes = await this.resolveQuantityLines(
        manager,
        seller,
        dto.quantityLines ?? [],
      );
      const allQrCodes = [...scannedCodes, ...quantityCodes];
      if (allQrCodes.length === 0) {
        throw new TraceabilityRuleException(
          'Scan at least one item, or sell by quantity (piece, carton, box…)',
        );
      }

      const items: TraceableItem[] = [];
      const seen = new Set<string>();
      for (const qrCode of allQrCodes) {
        if (seen.has(qrCode)) continue;
        seen.add(qrCode);
        const item = await this.itemService.require(qrCode, manager);
        requireHeldBy(item, seller);
        await this.requireSellable(manager, item);
        items.push(item);
      }

      const created = await manager.save(
        manager.create(Sale, {
          reference: nextReference('SL'),
          type: dto.type,
          sellerOrganization: seller,
          sellerLocation,
          buyerOrganization: buyer,
          consumerRef: dto.consumerRef ?? null,
          soldBy: actor,
          totalAmount: dto.totalAmount ?? null,
          notes: dto.notes ?? null,
        }),
      );

      let first = true;
      for (const item of items) {
        await manager.save(
          manager.create(SaleLine, {
            sale: created,
            item,
            quantity: item.quantity,
            unitPrice: null,
          }),
        );

        await this.recorder.record(manager, {
          item,
          type: EventType.SOLD,
          actor,
          meta: first ? dto.meta : null,
          sourceOrganization: seller,
          sourceLocation: sellerLocation,
          destinationOrganization: buyer,
          consumerRef: dto.type === SaleType.CONSUMER ? (dto.consumerRef ?? null) : null,
          quantity: item.quantity,
          notes: dto.notes ?? null,
        });

        first = false;
      }

      if (dto.type === SaleType.CONSUMER) {
        // A consumer sale marks the item and everything inside it as sold. The
        // container is not dissolved - a sold sealed box still knows what it
        // holds, which is what makes a recall of its contents workable.
        for (const item of items) {
          for (const member of await this.itemService.withDescendants(manager, item)) {
            member.status = ItemStatus.SOLD;
            member.consumerRef = dto.consumerRef ?? null;
            await manager.save(TraceableItem, member);
          }
        }
      }

      // Stash resolved codes on the sale object for the post-commit dispatch.
      (created as Sale & { _dispatchQrCodes?: string[] })._dispatchQrCodes =
        items.map((i) => i.qrCode);

      return created;
    });

    // Custody follows the goods through the normal dispatch/receive flow
    // rather than jumping to the buyer on payment alone. Raised after the sale
    // commits so a dispatch failure cannot leave a half-written sale.
    if (dto.type === SaleType.BUSINESS) {
      const dispatchCodes =
        (sale as Sale & { _dispatchQrCodes?: string[] })._dispatchQrCodes ??
        dto.itemQrCodes ??
        [];
      const transfer = await this.transferService.dispatch(seller, actor, {
        destinationOrganizationId: dto.buyerOrganizationId as number,
        destinationLocationId: dto.deliveryLocationId,
        sourceLocationId: dto.sellerLocationId,
        itemQrCodes: dispatchCodes,
        notes: `Sale ${sale.reference}`,
      });
      sale.transferId = transfer.id;
      await this.sales.save(sale);
    }

    return { sale, lines: await this.saleLines.find({ where: { sale: { id: sale.id } } }) };
  }

  /**
   * FEFO-pick whole identities that cover each quantity line's product units.
   * Same accumulation rule as sales-order reservation (DR-09) — no splits.
   */
  private async resolveQuantityLines(
    manager: EntityManager,
    seller: Organization,
    lines: SellQuantityLineDto[],
  ): Promise<string[]> {
    const qrCodes: string[] = [];

    for (const line of lines) {
      const product = await manager.findOne(Product, { where: { id: line.productId } });
      if (!product || product.organizationId !== seller.id) {
        throw new NotFoundEntityException('Product', line.productId);
      }

      const requested = parseFloat(line.requestedQuantity);
      const salesUnit = resolveSalesUnit(product, line.salesUnit);
      assertSalesUnit(product, salesUnit, requested);

      const needed = requestedProductUnits(product, salesUnit, requested);

      const candidates = await manager.find(TraceableItem, {
        where: {
          product: { id: product.id },
          holder: { id: seller.id },
          status: ItemStatus.ACTIVE,
        },
        order: {
          expiresOn: 'ASC' as never,
          id: 'ASC',
        },
      });
      const available = candidates.filter((item) => !item.parent);
      const availableUnits = available.reduce((sum, item) => sum + item.quantity, 0);

      if (availableUnits < needed) {
        const unitLabel = product.baseUnit ?? 'units';
        throw new TraceabilityRuleException(
          `Insufficient stock for ${product.name}: need ${needed} ${unitLabel}, ` +
            `only ${availableUnits} ${unitLabel} available`,
        );
      }

      let covered = 0;
      for (const item of available) {
        if (covered >= needed) break;
        if (qrCodes.includes(item.qrCode)) continue;
        qrCodes.push(item.qrCode);
        covered += item.quantity;
      }
    }

    return qrCodes;
  }

  /**
   * Records a sales-order fulfilment to a customer that is not an organization
   * on the platform.
   *
   * Those goods are not travelling anywhere the platform can follow. Nobody
   * downstream will confirm receipt, so raising a transfer would leave the
   * stock IN_TRANSIT for good; what has actually happened is that the goods
   * left the chain of custody, which is a sale. It is typed CONSUMER for that
   * reason and not as a judgement about the buyer - a wholesaler that never
   * registered ends the traceable chain exactly as a shopper does.
   *
   * Runs on the caller's `manager` so the sale, the events and the sales order
   * that prompted them commit together. `SellDto` deliberately is not reused:
   * the items are already resolved and already RESERVED to this order, and
   * `sell()` would refuse them for that reason (`blocksSale`).
   */
  async recordOffChainSale(
    manager: EntityManager,
    seller: Organization,
    actor: User | null,
    input: {
      items: TraceableItem[];
      consumerRef: string;
      totalAmount?: string | null;
      notes?: string | null;
    },
  ): Promise<Sale> {
    const sale = await manager.save(
      manager.create(Sale, {
        reference: nextReference('SL'),
        type: SaleType.CONSUMER,
        sellerOrganization: seller,
        sellerLocation: null,
        buyerOrganization: null,
        consumerRef: input.consumerRef,
        soldBy: actor,
        totalAmount: input.totalAmount ?? null,
        notes: input.notes ?? null,
      }),
    );

    for (const item of input.items) {
      await manager.save(
        manager.create(SaleLine, {
          sale,
          item,
          quantity: item.quantity,
          unitPrice: null,
        }),
      );

      await this.recorder.record(manager, {
        item,
        type: EventType.SOLD,
        actor,
        sourceOrganization: seller,
        destinationOrganization: null,
        consumerRef: input.consumerRef,
        quantity: item.quantity,
        notes: input.notes ?? null,
      });

      // A sold container is not dissolved: it still knows what it holds, which
      // is what makes recalling its contents workable.
      for (const member of await this.itemService.withDescendants(manager, item)) {
        member.status = ItemStatus.SOLD;
        member.consumerRef = input.consumerRef;
        await manager.save(TraceableItem, member);
      }
    }

    return sale;
  }

  async list(seller: Organization, page: number, size: number) {
    const [content, total] = await this.sales.findAndCount({
      where: { sellerOrganization: { id: seller.id } },
      order: { soldAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async linesOf(saleId: number): Promise<SaleLine[]> {
    return this.saleLines.find({ where: { sale: { id: saleId } } });
  }

  /**
   * Blocks the sale of anything recalled, quarantined, expired, damaged,
   * returned-but-uninspected or already sold (business rule 11).
   *
   * The check runs over the whole containment tree, not just the scanned
   * identity. A sealed box carries no batch of its own, so a recall that
   * reached the units inside it would otherwise leave the box sellable - and
   * the box is what the customer walks out with.
   */
  private async requireSellable(
    manager: EntityManager,
    item: TraceableItem,
  ): Promise<void> {
    if (item.status === ItemStatus.IN_TRANSIT) {
      throw new TraceabilityRuleException(
        `${item.code} is in transit and cannot be sold yet`,
      );
    }
    if (item.parent) {
      throw new TraceabilityRuleException(
        `${item.code} is inside ${item.parent.code} - sell the container, or remove the item first`,
      );
    }

    const now = today();
    const members = await this.itemService.withDescendants(manager, item);

    for (const member of members) {
      const where = member.id === item.id ? '' : ` (inside it: ${member.code})`;

      if (blocksSale(member.status)) {
        throw new TraceabilityRuleException(
          `${item.code} cannot be sold: it is ${member.status}${where}`,
        );
      }
      if (member.isExpired(now)) {
        throw new TraceabilityRuleException(
          `${item.code} expired on ${member.expiresOn} and cannot be sold${where}`,
        );
      }
      if (member.batch && !permitsTrade(member.batch.status)) {
        throw new TraceabilityRuleException(
          `Batch ${member.batch.batchCode} is ${member.batch.status} and cannot be sold${where}`,
        );
      }
    }
  }
}

function resolveSalesUnit(
  product: Product,
  requested: string | undefined,
): string | null {
  const offered = sellableUnits(product);
  if (offered.length === 0) {
    return requested?.trim() || null;
  }
  return (requested?.trim() || product.baseUnit || offered[0]) ?? null;
}

function assertSalesUnit(
  product: Product,
  salesUnit: string | null,
  requestedQuantity: number,
): void {
  const offered = sellableUnits(product);
  if (offered.length === 0) {
    if (salesUnit) {
      const msg = salesUnitPermitted(product, salesUnit, requestedQuantity);
      if (msg !== true) {
        throw new TraceabilityRuleException(msg);
      }
    }
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      throw new TraceabilityRuleException(
        `A sale line for ${product.name} needs a quantity above zero.`,
      );
    }
    return;
  }

  const msg = salesUnitPermitted(product, salesUnit ?? '', requestedQuantity);
  if (msg !== true) {
    throw new TraceabilityRuleException(msg);
  }
}

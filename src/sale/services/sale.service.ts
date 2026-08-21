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
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { TransferService, nextReference } from '../../transfer/services/transfer.service';
import { SellDto } from '../dto/sale.dto';
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

      const items: TraceableItem[] = [];
      for (const qrCode of dto.itemQrCodes) {
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

      return created;
    });

    // Custody follows the goods through the normal dispatch/receive flow
    // rather than jumping to the buyer on payment alone. Raised after the sale
    // commits so a dispatch failure cannot leave a half-written sale.
    if (dto.type === SaleType.BUSINESS) {
      const transfer = await this.transferService.dispatch(seller, actor, {
        destinationOrganizationId: dto.buyerOrganizationId as number,
        destinationLocationId: dto.deliveryLocationId,
        sourceLocationId: dto.sellerLocationId,
        itemQrCodes: dto.itemQrCodes,
        notes: `Sale ${sale.reference}`,
      });
      sale.transferId = transfer.id;
      await this.sales.save(sale);
    }

    return { sale, lines: await this.saleLines.find({ where: { sale: { id: sale.id } } }) };
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

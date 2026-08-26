import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { ItemStatus } from '../../item/item.enums';
import { ItemService } from '../../item/services/item.service';
import { SaleService } from '../../sale/services/sale.service';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import {
  salesUnitPermitted,
  sellableUnits,
} from '../../product/sales-unit';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import {
  Transfer,
  TransferLine,
  TransferStatus,
} from '../../transfer/entities/transfer.entity';
import { nextReference } from '../../transfer/services/transfer.service';
import { SequenceService } from '../../common/sequence.service';
import {
  SalesOrderStatus,
  canCancelOrder,
  canConfirmOrder,
  canFulfilOrder,
  computeTotals,
  lineTotal,
  round2,
} from '../commerce.enums';
import { CreateSalesOrderDto, QuotationLineDto } from '../dto/quotation.dto';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Quotation, QuotationLine } from '../entities/quotation.entity';
import { SalesOrder, SalesOrderLine } from '../entities/sales-order.entity';
import { SalesOrderReservation } from '../entities/sales-order-reservation.entity';
import {
  billedSalesQuantity,
  requestedProductUnits,
} from '../sales-line';

@Injectable()
export class SalesOrderService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SalesOrder)
    private readonly orders: Repository<SalesOrder>,
    @InjectRepository(SalesOrderLine)
    private readonly orderLines: Repository<SalesOrderLine>,
    @InjectRepository(SalesOrderReservation)
    private readonly reservations: Repository<SalesOrderReservation>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Quotation)
    private readonly quotations: Repository<Quotation>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    private readonly sequence: SequenceService,
    private readonly recorder: EventRecorder,
    private readonly items: ItemService,
    private readonly sales: SaleService,
  ) {}

  async create(
    organization: Organization,
    actor: User,
    dto: CreateSalesOrderDto,
  ): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.requireCustomer(manager, organization, dto.customerId);

      let quotation: Quotation | null = null;
      if (dto.quotationId) {
        quotation = await manager.findOne(Quotation, { where: { id: dto.quotationId } });
        if (!quotation || quotation.organization.id !== organization.id) {
          throw new NotFoundEntityException('Quotation', dto.quotationId);
        }
        if (quotation.status !== 'ACCEPTED') {
          throw new TraceabilityRuleException(
            `Quotation ${quotation.quotationNumber} is ${quotation.status}; only an accepted quotation can become an order`,
          );
        }
      }

      const orderNumber = await this.nextNumber(manager, 'SO');
      const totals = computeTotals(dto.lines.map(toAmountLine), parseFloat(dto.taxPercent ?? '0'));

      const order = await manager.save(
        manager.create(SalesOrder, {
          orderNumber,
          organization,
          customer,
          quotation,
          status: SalesOrderStatus.PLACED,
          requestedDeliveryOn: dto.requestedDeliveryOn ?? null,
          subtotal: totals.subtotal,
          taxPercent: dto.taxPercent ?? null,
          totalAmount: totals.total,
          notes: dto.notes ?? null,
          createdBy: actor,
          roundingAcceptedAt: null,
          roundingAcceptedBy: null,
        }),
      );

      for (const line of dto.lines) {
        await this.saveLine(manager, order.id, line);
      }

      return order;
    });
  }

  /**
   * A PLACED order is confirmed and its stock reserved (FEFO).
   *
   * Order of work (DR-09 WU-5 / trap 1): reserve → set fulfilment quantities →
   * recompute totals from what will ship → credit check. Never credit-check the
   * provisional requested total when rounding may raise the bill.
   */
  async confirm(
    organization: Organization,
    orderId: number,
    actor?: User | null,
  ): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canConfirmOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} and cannot be confirmed`,
        );
      }

      const lines = await manager.find(SalesOrderLine, {
        where: { order: { id: order.id } },
        relations: { product: true },
      });

      let needsRoundingAccept = false;

      for (const line of lines) {
        const result = await this.reserveLine(manager, organization, order, line);
        if (result.roundedUp) {
          needsRoundingAccept = true;
        }
      }

      if (needsRoundingAccept && !order.roundingAcceptedAt) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} rounds up from the requested quantities. ` +
            'Record rounding acceptance before confirming.',
        );
      }

      // Bill from fulfilment (product units → sales units), not the ask.
      const amountLines = lines.map((line) => {
        const fulfilment = parseFloat(line.fulfilmentQuantity ?? line.requestedQuantity);
        const qty = billedSalesQuantity(
          line.product,
          line.salesUnit,
          fulfilment,
        );
        return { quantity: qty, unitPrice: parseFloat(line.unitPrice) };
      });
      const totals = computeTotals(amountLines, parseFloat(order.taxPercent ?? '0'));
      order.subtotal = totals.subtotal;
      order.totalAmount = totals.total;

      for (const line of lines) {
        const fulfilment = parseFloat(line.fulfilmentQuantity ?? line.requestedQuantity);
        const qty = billedSalesQuantity(line.product, line.salesUnit, fulfilment);
        line.lineTotal = String(
          lineTotal({ quantity: qty, unitPrice: parseFloat(line.unitPrice) }),
        );
        await manager.save(SalesOrderLine, line);
      }

      await this.requireCredit(manager, organization, order);

      order.status = SalesOrderStatus.CONFIRMED;
      if (actor && needsRoundingAccept && !order.roundingAcceptedBy) {
        order.roundingAcceptedBy = actor;
      }
      return manager.save(SalesOrder, order);
    });
  }

  /**
   * Dry-run of what confirm would reserve — requested vs planned fulfilment —
   * without touching stock. Powers the three-quantity UI (DR-09 WU-8).
   */
  async planFulfilment(organization: Organization, orderId: number) {
    const order = await this.requireOwned(
      this.dataSource.manager,
      organization,
      orderId,
    );
    const lines = await this.orderLines.find({
      where: { order: { id: order.id } },
      relations: { product: true },
    });

    const planned = await Promise.all(
      lines.map(async (line) => {
        const needed = requestedProductUnits(
          line.product,
          line.salesUnit,
          parseFloat(line.requestedQuantity),
        );

        const candidates = await this.dataSource.manager.find(TraceableItem, {
          where: {
            product: { id: line.product.id },
            holder: { id: organization.id },
            status: ItemStatus.ACTIVE,
          },
          order: { expiresOn: 'ASC' as never, id: 'ASC' },
        });
        const available = candidates.filter((item) => !item.parent);

        let covered = 0;
        let identities = 0;
        for (const item of available) {
          if (covered >= needed) break;
          covered += item.quantity;
          identities += 1;
        }

        return {
          lineId: line.id,
          productId: line.product.id,
          productName: line.product.name,
          salesUnit: line.salesUnit,
          baseUnit: line.product.baseUnit,
          packUnit: line.product.packUnit,
          unitsPerPack: line.product.unitsPerPack,
          requestedQuantity: Number(line.requestedQuantity),
          requestedProductUnits: needed,
          plannedFulfilmentQuantity: covered >= needed ? covered : null,
          plannedIdentityCount: covered >= needed ? identities : null,
          availableProductUnits: available.reduce((s, i) => s + i.quantity, 0),
          roundedUp: covered >= needed && covered > needed + 1e-9,
          shortfall: covered < needed,
        };
      }),
    );

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      roundingAcceptedAt: order.roundingAcceptedAt,
      lines: planned,
      needsRoundingAccept: planned.some((l) => l.roundedUp),
    };
  }

  /**
   * Customer (or seller on their behalf) accepts warehouse rounding so confirm
   * may proceed when fulfilment exceeds the requested product units.
   */
  async acceptRounding(
    organization: Organization,
    orderId: number,
    actor: User,
  ): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (order.status !== SalesOrderStatus.PLACED) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status}; rounding is accepted on a placed order before confirm`,
        );
      }
      order.roundingAcceptedAt = new Date();
      order.roundingAcceptedBy = actor;
      return manager.save(SalesOrder, order);
    });
  }

  /**
   * Hands the reserved goods over to the buyer.
   *
   * What that means depends on whether the buyer is on the platform, which is
   * what `Customer.buyerOrganization` records:
   *
   * **A registered buyer** gets a Transfer, with a TransferLine per identity,
   * and the items go RESERVED → IN_TRANSIT. Custody moves only when the buyer
   * confirms receipt, through the same two-party flow as any other handover.
   * The transfer id is kept on the order so the seller can track dispatch
   * without a second lookup.
   *
   * **An off-platform buyer** cannot confirm anything, so a transfer to them
   * would strand the stock IN_TRANSIT for ever. Those goods have left the
   * traceable chain, which is a sale — see `SaleService.recordOffChainSale`.
   *
   * Note that `Customer.organization` is the *seller's* own organization, the
   * tenant that owns the customer record. Reading it as the destination is
   * what made every fulfilment a transfer addressed back to the sender.
   */
  async fulfil(organization: Organization, orderId: number): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canFulfilOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} and cannot be fulfilled`,
        );
      }

      // Gather all reserved identities for this order.
      const reservedRows = await manager.find(SalesOrderReservation, {
        where: { order: { id: order.id } },
        relations: { item: true },
      });

      if (reservedRows.length === 0) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} has no reserved stock — confirm it first`,
        );
      }

      const items: TraceableItem[] = [];
      for (const row of reservedRows) {
        const item = row.item;
        if (item.status !== ItemStatus.RESERVED) {
          throw new TraceabilityRuleException(
            `${item.code} is ${item.status}, not RESERVED — stock may have been moved`,
          );
        }
        items.push(item);
      }

      const buyer = order.customer.buyerOrganization ?? null;

      if (buyer) {
        await this.dispatchToBuyer(manager, organization, order, buyer, reservedRows);
      } else {
        const sale = await this.sales.recordOffChainSale(manager, organization, null, {
          items,
          consumerRef: order.customer.code,
          totalAmount: order.totalAmount ?? null,
          notes: `Fulfilment of ${order.orderNumber} to ${order.customer.name}`,
        });
        order.saleId = sale.id;
      }

      order.status = SalesOrderStatus.FULFILLED;
      return manager.save(SalesOrder, order);
    });
  }

  /**
   * The registered-buyer path: one transfer, one line per identity, and the
   * goods marked IN_TRANSIT until the buyer confirms.
   *
   * The lines are the part that matters. `TransferService.receive` iterates
   * them to decide what arrived, so a transfer without them closes as RECEIVED
   * having moved nothing while its items stay IN_TRANSIT under the sender.
   */
  private async dispatchToBuyer(
    manager: EntityManager,
    seller: Organization,
    order: SalesOrder,
    buyer: Organization,
    reservedRows: SalesOrderReservation[],
  ): Promise<Transfer> {
    const transfer = await manager.save(
      manager.create(Transfer, {
        reference: nextReference('TRF'),
        sourceOrganization: seller,
        destinationOrganization: buyer,
        status: TransferStatus.DISPATCHED,
        dispatchedBy: null,
        notes: `Fulfilment of ${order.orderNumber}`,
      }),
    );

    let first = true;
    for (const row of reservedRows) {
      const item = row.item;

      await manager.save(manager.create(TransferLine, { transfer, item }));

      // Contents travel with their container, so a dispatched box does not
      // leave its units behind as available stock.
      for (const member of await this.items.withDescendants(manager, item)) {
        member.status = ItemStatus.IN_TRANSIT;
        await manager.save(TraceableItem, member);
      }

      await this.recorder.record(manager, {
        item,
        type: EventType.DISPATCHED,
        actor: null,
        meta: first
          ? {
              clientEventId: `fulfil-${order.id}`,
              deviceId: 'system',
              occurredAt: new Date().toISOString(),
            }
          : null,
        sourceOrganization: seller,
        destinationOrganization: buyer,
        quantity: row.quantity,
        notes: `Fulfilment of ${order.orderNumber}`,
      });

      first = false;
    }

    order.transferId = transfer.id;
    return transfer;
  }

  /**
   * Cancels the order and gives its reserved stock back (DR-09 WU-6).
   *
   * Cancelling used to set the status and stop there, which stranded the
   * goods permanently: the identities stayed RESERVED, and `sell`,
   * `dispatch` and `relocate` all refuse RESERVED, so nothing could ever be
   * done with them again. Any order cancelled before this change has stock
   * that needs `scripts/release-stranded-reservations.ts` run over it once.
   */
  async cancel(organization: Organization, orderId: number): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canCancelOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} and cannot be cancelled`,
        );
      }

      await this.releaseReservations(manager, organization, order, 'cancelled');

      order.status = SalesOrderStatus.CANCELLED;
      return manager.save(SalesOrder, order);
    });
  }

  /**
   * Gives a confirmed order's stock back without cancelling the order.
   *
   * The order returns to PLACED, which is the only honest place for it: it
   * still exists and is still wanted, but nothing is committed to it any
   * more. Leaving it CONFIRMED with no reservations would let someone call
   * `fulfil()` on an order with nothing to fulfil, and PLACED is exactly the
   * state `confirm()` accepts, so re-reserving is one call away.
   *
   * Used when stock reserved for one customer is needed for another, or when
   * an order is going to sit unfulfilled long enough that holding the goods
   * costs more than the order is worth.
   */
  async release(organization: Organization, orderId: number): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (order.status !== SalesOrderStatus.CONFIRMED) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status}; only a CONFIRMED order holds stock to release`,
        );
      }

      const released = await this.releaseReservations(
        manager,
        organization,
        order,
        'released',
      );

      if (released === 0) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} holds no reserved stock`,
        );
      }

      order.status = SalesOrderStatus.PLACED;
      return manager.save(SalesOrder, order);
    });
  }

  /**
   * Returns every identity this order still holds to ACTIVE, and says so in
   * the timeline. Answers with how many were actually released.
   *
   * The reservation rows are deliberately left in place (DR-09 invariant 9).
   * They record that this stock *was* committed to this order, which stays
   * true after the commitment ends; deleting them would erase the reason the
   * goods sat unavailable for however long they did.
   *
   * Only items still RESERVED are touched. Anything else — already dispatched
   * on another route, sold, recalled — is somebody else's transition, and
   * forcing it back to ACTIVE here would be inventing stock.
   */
  private async releaseReservations(
    manager: EntityManager,
    organization: Organization,
    order: SalesOrder,
    verb: 'cancelled' | 'released',
  ): Promise<number> {
    const rows = await manager.find(SalesOrderReservation, {
      where: { order: { id: order.id } },
      relations: { item: true },
    });

    let released = 0;

    for (const row of rows) {
      const item = row.item;
      if (!item || item.status !== ItemStatus.RESERVED) continue;

      item.status = ItemStatus.ACTIVE;
      await manager.save(TraceableItem, item);

      await this.recorder.record(manager, {
        item,
        type: EventType.RELEASED,
        actor: null,
        destinationOrganization: organization,
        quantity: row.quantity,
        notes: `Reservation for ${order.orderNumber} ${verb}`,
      });

      released++;
    }

    return released;
  }

  async list(organization: Organization, page: number, size: number) {
    const [content, total] = await this.orders.findAndCount({
      where: { organization: { id: organization.id } },
      order: { createdAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async get(organization: Organization, orderId: number): Promise<SalesOrder> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order || order.organization.id !== organization.id) {
      throw new NotFoundEntityException('SalesOrder', orderId);
    }
    return order;
  }

  async linesOf(orderId: number): Promise<SalesOrderLine[]> {
    return this.orderLines.find({
      where: { order: { id: orderId } },
      order: { id: 'ASC' },
    });
  }

  /**
   * Credit management (proposal section 6): a customer with a credit ceiling
   * may not have more outstanding (unpaid invoices plus this order) than the
   * ceiling allows.
   */
  private async requireCredit(
    manager: EntityManager,
    organization: Organization,
    order: SalesOrder,
  ): Promise<void> {
    if (order.customer.creditLimit === null) return;

    const ceiling = parseFloat(order.customer.creditLimit);
    const open = await this.openBalance(manager, organization, order.customer.id);
    const commitment = open + parseFloat(order.totalAmount ?? '0');

    if (commitment > ceiling) {
      throw new TraceabilityRuleException(
        `Confirming ${order.orderNumber} would put ${order.customer.name} ${round2(commitment)} above its credit ceiling of ${round2(ceiling)}`,
      );
    }
  }

  private async openBalance(
    manager: EntityManager,
    organization: Organization,
    customerId: number,
  ): Promise<number> {
    const invoices = await manager.find(Invoice, {
      where: { organization: { id: organization.id }, customer: { id: customerId } },
    });
    return invoices.reduce((sum, invoice) => {
      const total = parseFloat(invoice.totalAmount ?? '0');
      const paid = parseFloat(invoice.amountPaid ?? '0');
      return sum + Math.max(total - paid, 0);
    }, 0);
  }

  private async saveLine(
    manager: EntityManager,
    orderId: number,
    line: QuotationLineDto,
  ): Promise<SalesOrderLine> {
    const product = await manager.findOne(Product, { where: { id: line.productId } });
    if (!product) {
      throw new NotFoundEntityException('Product', line.productId);
    }

    const requested = parseFloat(line.requestedQuantity);
    const salesUnit = resolveSalesUnit(product, line.salesUnit);
    assertSalesUnit(product, salesUnit, requested);

    const total = lineTotal({
      quantity: requested,
      unitPrice: parseFloat(line.unitPrice),
    });
    return manager.save(
      manager.create(SalesOrderLine, {
        order: { id: orderId } as SalesOrder,
        product,
        description: line.description ?? product.name,
        requestedQuantity: line.requestedQuantity,
        salesUnit,
        fulfilmentQuantity: null,
        unitPrice: line.unitPrice,
        lineTotal: String(total),
      }),
    );
  }

  private async requireCustomer(
    manager: EntityManager,
    organization: Organization,
    customerId: number,
  ): Promise<Customer> {
    const customer = await manager.findOne(Customer, { where: { id: customerId } });
    if (!customer || customer.organization.id !== organization.id) {
      throw new NotFoundEntityException('Customer', customerId);
    }
    return customer;
  }

  private async requireOwned(
    manager: EntityManager,
    organization: Organization,
    orderId: number,
  ): Promise<SalesOrder> {
    const order = await manager.findOne(SalesOrder, { where: { id: orderId } });
    if (!order || order.organization.id !== organization.id) {
      throw new NotFoundEntityException('SalesOrder', orderId);
    }
    return order;
  }

  /**
   * FEFO reservation in product units (DR-09 WU-5).
   *
   * Accumulates `item.quantity` until the requested product units are covered,
   * writes the true quantity on each reservation row, and sets the line's
   * `fulfilmentQuantity` to the sum. Whole identities only — never splits.
   */
  private async reserveLine(
    manager: EntityManager,
    organization: Organization,
    order: SalesOrder,
    line: SalesOrderLine,
  ): Promise<{ roundedUp: boolean }> {
    const needed = requestedProductUnits(
      line.product,
      line.salesUnit,
      parseFloat(line.requestedQuantity),
    );

    const candidates = await manager.find(TraceableItem, {
      where: {
        product: { id: line.product.id },
        holder: { id: organization.id },
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
      const unitLabel = line.product.baseUnit ?? 'units';
      throw new TraceabilityRuleException(
        `Insufficient stock for ${line.product.name}: need ${needed} ${unitLabel}, ` +
          `only ${availableUnits} ${unitLabel} available`,
      );
    }

    const picks: TraceableItem[] = [];
    let covered = 0;
    for (const item of available) {
      if (covered >= needed) break;
      picks.push(item);
      covered += item.quantity;
    }

    const roundedUp = covered > needed + 1e-9;

    for (const item of picks) {
      item.status = ItemStatus.RESERVED;
      await manager.save(TraceableItem, item);

      await manager.save(
        manager.create(SalesOrderReservation, {
          order,
          orderLine: line,
          item,
          quantity: item.quantity,
        }),
      );

      await this.recorder.record(manager, {
        item,
        type: EventType.RESERVED,
        actor: null,
        destinationOrganization: organization,
        quantity: item.quantity,
        notes: `Reserved for ${order.orderNumber}`,
      });
    }

    line.fulfilmentQuantity = String(covered);
    await manager.save(SalesOrderLine, line);

    return { roundedUp };
  }

  private async nextNumber(manager: EntityManager, prefix: string): Promise<string> {
    const value = await this.sequence.next(manager, prefix);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}

function toAmountLine(line: QuotationLineDto) {
  return {
    quantity: parseFloat(line.requestedQuantity),
    unitPrice: parseFloat(line.unitPrice),
  };
}

/** Null when the product has no units declared (legacy bare quantity). */
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
        `An order line for ${product.name} needs a quantity above zero.`,
      );
    }
    return;
  }

  const msg = salesUnitPermitted(product, salesUnit ?? '', requestedQuantity);
  if (msg !== true) {
    throw new TraceabilityRuleException(msg);
  }
}
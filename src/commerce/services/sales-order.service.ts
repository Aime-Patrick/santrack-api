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
   * Confirmation checks the customer's credit ceiling, then for each order
   * line picks the available identities expiring soonest — First Expired,
   * First Out.  Reserved items carry ItemStatus.RESERVED: they cannot be
   * sold to another customer, dispatched on a different order, or relocated
   * away from where fulfilment expects to find them.
   *
   * If there is not enough available stock to cover the line, confirmation
   * is refused rather than partially reserving — the seller must decide
   * whether to split the order or wait for more stock.
   */
  async confirm(organization: Organization, orderId: number): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canConfirmOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} and cannot be confirmed`,
        );
      }

      await this.requireCredit(manager, organization, order);

      // Reserve stock for each line using FEFO.
      const lines = await manager.find(SalesOrderLine, {
        where: { order: { id: order.id } },
        relations: { product: true },
      });

      for (const line of lines) {
        const needed = parseInt(line.quantity, 10);
        await this.reserveLine(manager, organization, order, line, needed);
      }

      order.status = SalesOrderStatus.CONFIRMED;
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

  async cancel(organization: Organization, orderId: number): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canCancelOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} and cannot be cancelled`,
        );
      }
      order.status = SalesOrderStatus.CANCELLED;
      return manager.save(SalesOrder, order);
    });
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
    const total = lineTotal({
      quantity: parseFloat(line.quantity),
      unitPrice: parseFloat(line.unitPrice),
    });
    return manager.save(
      manager.create(SalesOrderLine, {
        order: { id: orderId } as SalesOrder,
        product,
        description: line.description ?? product.name,
        quantity: line.quantity,
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
   * FEFO reservation: picks the available identities for a product that
   * expire soonest.  Items with no expiry are picked last (they never
   * become unsellable, so there is no urgency).
   *
   * Each picked item moves to RESERVED and a reservation row ties it to
   * the order line.  The caller must be inside a transaction.
   */
  private async reserveLine(
    manager: EntityManager,
    organization: Organization,
    order: SalesOrder,
    line: SalesOrderLine,
    needed: number,
  ): Promise<void> {
    // Available items: same product, held by this org, ACTIVE, not in a
    // container (top-level only — you dispatch what you hold directly).
    const candidates = await manager.find(TraceableItem, {
      where: {
        product: { id: line.product.id },
        holder: { id: organization.id },
        status: ItemStatus.ACTIVE,
      },
      order: {
        // FEFO: items expiring soonest first; null expires last.
        expiresOn: 'ASC' as never,
        id: 'ASC',
      },
    });

    // Filter to top-level only (not inside a container).
    const available = candidates.filter((item) => !item.parent);

    if (available.length < needed) {
      throw new TraceabilityRuleException(
        `Insufficient stock for ${line.product.name}: need ${needed}, ` +
          `only ${available.length} available`,
      );
    }

    let remaining = needed;
    for (const item of available) {
      if (remaining <= 0) break;

      item.status = ItemStatus.RESERVED;
      await manager.save(TraceableItem, item);

      await manager.save(
        manager.create(SalesOrderReservation, {
          order,
          orderLine: line,
          item,
          quantity: 1,
        }),
      );

      await this.recorder.record(manager, {
        item,
        type: EventType.RESERVED,
        actor: null,
        destinationOrganization: organization,
        quantity: 1,
        notes: `Reserved for ${order.orderNumber}`,
      });

      remaining--;
    }
  }

  private async nextNumber(manager: EntityManager, prefix: string): Promise<string> {
    const value = await this.sequence.next(manager, prefix);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}

function toAmountLine(line: QuotationLineDto) {
  return { quantity: parseFloat(line.quantity), unitPrice: parseFloat(line.unitPrice) };
}
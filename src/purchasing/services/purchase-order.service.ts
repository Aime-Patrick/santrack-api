import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { SequenceService } from '../../common/sequence.service';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderLineDto,
  ReceivePurchaseOrderDto,
} from '../dto/purchase-order.dto';
import { PurchaseOrder, PurchaseOrderLine } from '../entities/purchase-order.entity';
import { Supplier } from '../entities/supplier.entity';
import {
  PurchaseOrderStatus,
  canCancelPurchaseOrder,
  canConfirmPurchaseOrder,
  canReceivePurchaseOrder,
  canSendPurchaseOrder,
  computeTotals,
  lineTotal,
} from '../purchasing.enums';
import { assertPurchasingOrg } from './supplier.service';

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PurchaseOrder)
    private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderLine)
    private readonly lines: Repository<PurchaseOrderLine>,
    private readonly sequence: SequenceService,
  ) {}

  async create(
    organization: Organization,
    actor: User,
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrder> {
    assertPurchasingOrg(organization);

    return this.dataSource.transaction(async (manager) => {
      const supplier = await this.requireSupplier(manager, organization, dto.supplierId);
      if (!supplier.active) {
        throw new TraceabilityRuleException(
          `Supplier ${supplier.code} is inactive and cannot receive new orders`,
        );
      }

      const poNumber = await this.nextNumber(manager, 'PO');
      const totals = computeTotals(
        dto.lines.map(toAmountLine),
        parseFloat(dto.taxPercent ?? '0'),
      );

      const order = await manager.save(
        manager.create(PurchaseOrder, {
          poNumber,
          organization,
          supplier,
          status: PurchaseOrderStatus.DRAFT,
          expectedOn: dto.expectedOn ?? null,
          subtotal: totals.subtotal,
          taxPercent: dto.taxPercent ?? null,
          totalAmount: totals.total,
          notes: dto.notes ?? null,
          createdBy: actor,
        }),
      );

      for (const line of dto.lines) {
        await this.saveLine(manager, organization, order.id, line);
      }

      return order;
    });
  }

  async send(organization: Organization, orderId: number): Promise<PurchaseOrder> {
    assertPurchasingOrg(organization);
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canSendPurchaseOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Purchase order ${order.poNumber} is ${order.status} and cannot be sent`,
        );
      }
      order.status = PurchaseOrderStatus.SENT;
      return manager.save(PurchaseOrder, order);
    });
  }

  /**
   * Acknowledges the commercial deal. Does not reserve stock, create a
   * transfer, or move identities (DR-10 D2 / D4).
   */
  async confirm(organization: Organization, orderId: number): Promise<PurchaseOrder> {
    assertPurchasingOrg(organization);
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canConfirmPurchaseOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Purchase order ${order.poNumber} is ${order.status} and cannot be confirmed`,
        );
      }
      order.status = PurchaseOrderStatus.CONFIRMED;
      return manager.save(PurchaseOrder, order);
    });
  }

  async cancel(organization: Organization, orderId: number): Promise<PurchaseOrder> {
    assertPurchasingOrg(organization);
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canCancelPurchaseOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Purchase order ${order.poNumber} is ${order.status} and cannot be cancelled`,
        );
      }
      order.status = PurchaseOrderStatus.CANCELLED;
      return manager.save(PurchaseOrder, order);
    });
  }

  /**
   * Records commercial receive progress on lines. Does **not** put goods on
   * hand — operators still receive physical stock via Transfer receive
   * (DR-10 D4). Moves status to RECEIVING, then CLOSED when every line is
   * fully received.
   */
  async receive(
    organization: Organization,
    orderId: number,
    dto: ReceivePurchaseOrderDto,
  ): Promise<PurchaseOrder> {
    assertPurchasingOrg(organization);

    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwned(manager, organization, orderId);
      if (!canReceivePurchaseOrder(order.status)) {
        throw new TraceabilityRuleException(
          `Purchase order ${order.poNumber} is ${order.status} and cannot receive`,
        );
      }

      const orderLines = await manager.find(PurchaseOrderLine, {
        where: { purchaseOrder: { id: order.id } },
        relations: { product: true },
      });
      const byId = new Map(orderLines.map((line) => [line.id, line]));

      for (const receipt of dto.lines) {
        const line = byId.get(receipt.lineId);
        if (!line) {
          throw new NotFoundEntityException('PurchaseOrderLine', receipt.lineId);
        }

        const add = parseFloat(receipt.quantity);
        if (!Number.isFinite(add) || add <= 0) {
          throw new TraceabilityRuleException(
            `Receive quantity for line ${line.id} must be above zero`,
          );
        }

        const ordered = parseFloat(line.quantity);
        const already = parseFloat(line.receivedQuantity ?? '0');
        const next = already + add;
        if (next > ordered + Number.EPSILON) {
          throw new TraceabilityRuleException(
            `Line ${line.id} would receive ${next} against ordered ${ordered}`,
          );
        }

        line.receivedQuantity = String(next);
        await manager.save(PurchaseOrderLine, line);
      }

      const refreshed = await manager.find(PurchaseOrderLine, {
        where: { purchaseOrder: { id: order.id } },
      });
      const complete = refreshed.every(
        (line) => parseFloat(line.receivedQuantity ?? '0') >= parseFloat(line.quantity),
      );

      order.status = complete
        ? PurchaseOrderStatus.CLOSED
        : PurchaseOrderStatus.RECEIVING;
      return manager.save(PurchaseOrder, order);
    });
  }

  async list(organization: Organization, page: number, size: number) {
    assertPurchasingOrg(organization);
    const [content, total] = await this.orders.findAndCount({
      where: { organization: { id: organization.id } },
      order: { createdAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async get(organization: Organization, orderId: number): Promise<PurchaseOrder> {
    assertPurchasingOrg(organization);
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order || order.organization.id !== organization.id) {
      throw new NotFoundEntityException('PurchaseOrder', orderId);
    }
    return order;
  }

  async linesOf(orderId: number): Promise<PurchaseOrderLine[]> {
    return this.lines.find({
      where: { purchaseOrder: { id: orderId } },
      order: { id: 'ASC' },
    });
  }

  private async saveLine(
    manager: EntityManager,
    organization: Organization,
    orderId: number,
    line: PurchaseOrderLineDto,
  ): Promise<PurchaseOrderLine> {
    const product = await manager.findOne(Product, { where: { id: line.productId } });
    if (!product || product.organizationId !== organization.id) {
      throw new NotFoundEntityException('Product', line.productId);
    }

    const quantity = parseFloat(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new TraceabilityRuleException(
        `A purchase line for ${product.name} needs a quantity above zero`,
      );
    }

    const total = lineTotal({
      quantity,
      unitPrice: parseFloat(line.unitPrice),
    });

    return manager.save(
      manager.create(PurchaseOrderLine, {
        purchaseOrder: { id: orderId } as PurchaseOrder,
        product,
        description: line.description ?? product.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: String(total),
        receivedQuantity: '0',
      }),
    );
  }

  private async requireSupplier(
    manager: EntityManager,
    organization: Organization,
    supplierId: number,
  ): Promise<Supplier> {
    const supplier = await manager.findOne(Supplier, { where: { id: supplierId } });
    if (!supplier || supplier.organization.id !== organization.id) {
      throw new NotFoundEntityException('Supplier', supplierId);
    }
    return supplier;
  }

  private async requireOwned(
    manager: EntityManager,
    organization: Organization,
    orderId: number,
  ): Promise<PurchaseOrder> {
    const order = await manager.findOne(PurchaseOrder, { where: { id: orderId } });
    if (!order || order.organization.id !== organization.id) {
      throw new NotFoundEntityException('PurchaseOrder', orderId);
    }
    return order;
  }

  private async nextNumber(manager: EntityManager, prefix: string): Promise<string> {
    const value = await this.sequence.next(manager, prefix);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}

function toAmountLine(line: PurchaseOrderLineDto) {
  return {
    quantity: parseFloat(line.quantity),
    unitPrice: parseFloat(line.unitPrice),
  };
}

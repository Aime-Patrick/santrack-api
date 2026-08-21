import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { ItemStatus } from '../../item/item.enums';
import {
  ItemService,
  requireHeldBy,
} from '../../item/services/item.service';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { SequenceService } from '../../common/sequence.service';
import { Organization } from '../../organization/entities/organization.entity';
import {
  ReturnStatus,
  canApproveReturn,
  canRefundReturn,
  canRejectReturn,
} from '../commerce.enums';
import {
  ApproveReturnDto,
  RejectReturnDto,
  RequestReturnDto,
} from '../dto/invoice.dto';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { SalesReturn } from '../entities/sales-return.entity';

@Injectable()
export class SalesReturnService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SalesReturn)
    private readonly returns: Repository<SalesReturn>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    private readonly sequence: SequenceService,
    private readonly itemService: ItemService,
    private readonly recorder: EventRecorder,
  ) {}

  async request(
    organization: Organization,
    actor: User,
    dto: RequestReturnDto,
  ): Promise<SalesReturn> {
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.requireCustomer(manager, organization, dto.customerId);
      const invoice = dto.invoiceId
        ? await this.requireInvoice(manager, organization, dto.invoiceId)
        : null;

      const returnNumber = await this.nextNumber(manager, 'RET');
      return manager.save(
        manager.create(SalesReturn, {
          returnNumber,
          organization,
          customer,
          invoice,
          status: ReturnStatus.REQUESTED,
          reason: dto.reason.trim(),
          refundAmount: null,
          createdBy: actor,
        }),
      );
    });
  }

  /**
   * Approves the return and restocks the goods.
   *
   * The items sold on the linked invoice are moved from SOLD back to
   * RETURNED status — awaiting inspection before they can re-enter normal
   * stock.  A RETURNED traceability event is recorded on each item so the
   * timeline shows why the product came back.
   *
   * Items with no linked invoice (e.g. a walk-in consumer sale that was not
   * billed) are restocked individually by QR code through a separate
   * receive-items endpoint; this method handles the invoice-linked case.
   */
  async approve(
    organization: Organization,
    actor: User,
    returnId: number,
    dto: ApproveReturnDto,
  ): Promise<SalesReturn> {
    return this.dataSource.transaction(async (manager) => {
      const salesReturn = await this.requireOwned(manager, organization, returnId);
      if (!canApproveReturn(salesReturn.status)) {
        throw new TraceabilityRuleException(
          `Return ${salesReturn.returnNumber} is ${salesReturn.status} and cannot be approved`,
        );
      }

      let refundAmount = dto.refundAmount;
      if (!refundAmount) {
        refundAmount = salesReturn.invoice?.totalAmount ?? '0';
      }
      const refund = parseFloat(refundAmount);
      const billed = parseFloat(salesReturn.invoice?.totalAmount ?? '0');
      if (refund > billed) {
        throw new TraceabilityRuleException(
          `A refund of ${refundAmount} exceeds the invoice total of ${billed}`,
        );
      }

      salesReturn.status = ReturnStatus.APPROVED;
      salesReturn.refundAmount = refundAmount;
      await manager.save(SalesReturn, salesReturn);

      // Restock: move each returned item from SOLD back to RETURNED.
      // The items are held by the customer (seller is the organization
      // approving the return), so we transfer custody back by changing
      // status and recording the event.
      let first = true;
      for (const qrCode of dto.itemQrCodes) {
        const item = await this.itemService.require(qrCode, manager);

        if (item.status !== ItemStatus.SOLD) {
          throw new TraceabilityRuleException(
            `${item.code} is ${item.status}, not SOLD — only sold items can be returned`,
          );
        }

        item.status = ItemStatus.RETURNED;
        item.holder = organization;
        await manager.save(TraceableItem, item);

        await this.recorder.record(manager, {
          item,
          type: EventType.RETURNED,
          actor,
          meta: first ? { clientEventId: `return-${salesReturn.id}`, deviceId: 'system', occurredAt: new Date().toISOString() } : null,
          sourceOrganization: organization,
          quantity: 1,
          notes: `Return ${salesReturn.returnNumber} approved: ${dto.notes ?? salesReturn.reason}`,
        });

        first = false;
      }

      return salesReturn;
    });
  }

  /** A refund is paid out; the return is closed. */
  async refund(organization: Organization, returnId: number): Promise<SalesReturn> {
    return this.dataSource.transaction(async (manager) => {
      const salesReturn = await this.requireOwned(manager, organization, returnId);
      if (!canRefundReturn(salesReturn.status)) {
        throw new TraceabilityRuleException(
          `Return ${salesReturn.returnNumber} is ${salesReturn.status} and cannot be refunded`,
        );
      }
      salesReturn.status = ReturnStatus.REFUNDED;
      return manager.save(SalesReturn, salesReturn);
    });
  }

  async reject(
    organization: Organization,
    returnId: number,
    dto: RejectReturnDto,
  ): Promise<SalesReturn> {
    return this.dataSource.transaction(async (manager) => {
      const salesReturn = await this.requireOwned(manager, organization, returnId);
      if (!canRejectReturn(salesReturn.status)) {
        throw new TraceabilityRuleException(
          `Return ${salesReturn.returnNumber} is ${salesReturn.status} and cannot be rejected`,
        );
      }
      salesReturn.status = ReturnStatus.REJECTED;
      salesReturn.reason = `${salesReturn.reason} | Rejected: ${dto.reason}`;
      return manager.save(SalesReturn, salesReturn);
    });
  }

  async list(organization: Organization, page: number, size: number) {
    const [content, total] = await this.returns.findAndCount({
      where: { organization: { id: organization.id } },
      order: { createdAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async get(organization: Organization, returnId: number): Promise<SalesReturn> {
    const salesReturn = await this.returns.findOne({ where: { id: returnId } });
    if (!salesReturn || salesReturn.organization.id !== organization.id) {
      throw new NotFoundEntityException('SalesReturn', returnId);
    }
    return salesReturn;
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

  private async requireInvoice(
    manager: EntityManager,
    organization: Organization,
    invoiceId: number,
  ): Promise<Invoice> {
    const invoice = await manager.findOne(Invoice, { where: { id: invoiceId } });
    if (!invoice || invoice.organization.id !== organization.id) {
      throw new NotFoundEntityException('Invoice', invoiceId);
    }
    return invoice;
  }

  private async requireOwned(
    manager: EntityManager,
    organization: Organization,
    returnId: number,
  ): Promise<SalesReturn> {
    const salesReturn = await manager.findOne(SalesReturn, { where: { id: returnId } });
    if (!salesReturn || salesReturn.organization.id !== organization.id) {
      throw new NotFoundEntityException('SalesReturn', returnId);
    }
    return salesReturn;
  }

  private async nextNumber(manager: EntityManager, prefix: string): Promise<string> {
    const value = await this.sequence.next(manager, prefix);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}
import { DataSource, EntityManager } from 'typeorm';

import { ItemStatus } from '../../item/item.enums';
import { ItemService } from '../../item/services/item.service';
import { SaleService } from '../../sale/services/sale.service';
import { TraceabilityRuleException } from '../../common/errors';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { Transfer, TransferLine } from '../../transfer/entities/transfer.entity';
import { SalesOrderStatus } from '../commerce.enums';
import { SalesOrderService } from './sales-order.service';

/**
 * Fulfilment, and where the goods actually end up.
 *
 * `Customer.organization` is the seller - the tenant that owns the customer
 * record - so reading it as the destination addressed every transfer back to
 * the sender, and no TransferLine rows were written, which left the stock
 * IN_TRANSIT with nothing for the buyer to receive. Both paths are asserted
 * here because neither is covered by a walkthrough.
 */

const SELLER = { id: 1, name: 'Seller Ltd' };
const BUYER = { id: 2, name: 'Buyer Ltd' };

function harness(customer: Record<string, unknown>, itemStatus = ItemStatus.RESERVED) {
  const item = {
    id: 100,
    code: 'ITM-100',
    qrCode: 'qr-100',
    status: itemStatus,
    quantity: 1,
    consumerRef: null as string | null,
  };

  const order = {
    id: 5,
    orderNumber: 'SO-0005',
    organization: SELLER,
    customer,
    status: SalesOrderStatus.CONFIRMED,
    totalAmount: '1200.00',
    transferId: null as number | null,
    saleId: null as number | null,
  };

  const transfers: Record<string, unknown>[] = [];
  const transferLines: Record<string, unknown>[] = [];
  const traceEvents: { type: EventType; destinationOrganization?: unknown }[] = [];

  const manager = {
    findOne: jest.fn().mockResolvedValue(order),
    find: jest.fn().mockResolvedValue([{ id: 1, order, item, quantity: 1 }]),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === Transfer) transfers.push(data);
      if (entity === TransferLine) transferLines.push(data);
      return data;
    }),
    save: jest.fn((_entity: unknown, data?: unknown) => Promise.resolve(data ?? _entity)),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: (cb: (m: EntityManager) => Promise<unknown>) => cb(manager),
  } as unknown as DataSource;

  const recorder = {
    record: jest.fn((_m: EntityManager, input: { type: EventType }) => {
      traceEvents.push(input as (typeof traceEvents)[number]);
      return Promise.resolve(input);
    }),
  } as unknown as EventRecorder;

  const items = {
    withDescendants: jest.fn().mockImplementation((_m, root) => Promise.resolve([root])),
  } as unknown as ItemService;

  const sales = {
    recordOffChainSale: jest.fn().mockResolvedValue({ id: 77 }),
  } as unknown as SaleService;

  const service = new SalesOrderService(
    dataSource,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    recorder,
    items,
    sales,
  );

  return { service, order, item, transfers, transferLines, traceEvents, sales, items };
}

const registeredCustomer = {
  id: 30,
  code: 'CST-AAAA',
  name: 'Buyer Ltd',
  organization: SELLER,
  buyerOrganization: BUYER,
};

const offPlatformCustomer = {
  id: 31,
  code: 'CST-BBBB',
  name: 'Corner Shop',
  organization: SELLER,
  buyerOrganization: null,
};

describe('fulfilling to a registered buyer', () => {
  it('addresses the transfer to the buyer, not the seller', async () => {
    const h = harness(registeredCustomer);

    await h.service.fulfil(SELLER as never, 5);

    expect(h.transfers).toHaveLength(1);
    expect(h.transfers[0].destinationOrganization).toBe(BUYER);
    expect(h.transfers[0].sourceOrganization).toBe(SELLER);
  });

  it('writes a transfer line per identity', async () => {
    const h = harness(registeredCustomer);

    await h.service.fulfil(SELLER as never, 5);

    // receive() iterates these. Without them the transfer closes as RECEIVED
    // having moved nothing, and the goods stay IN_TRANSIT under the sender.
    expect(h.transferLines).toHaveLength(1);
    expect((h.transferLines[0] as { item: { code: string } }).item.code).toBe('ITM-100');
  });

  it('moves the goods and their contents to IN_TRANSIT', async () => {
    const h = harness(registeredCustomer);

    await h.service.fulfil(SELLER as never, 5);

    expect(h.item.status).toBe(ItemStatus.IN_TRANSIT);
    expect(h.items.withDescendants).toHaveBeenCalled();
  });

  it('records DISPATCHED towards the buyer and links the transfer to the order', async () => {
    const h = harness(registeredCustomer);

    await h.service.fulfil(SELLER as never, 5);

    const dispatched = h.traceEvents.find((e) => e.type === EventType.DISPATCHED);
    expect(dispatched).toBeDefined();
    expect(dispatched!.destinationOrganization).toBe(BUYER);
    expect(h.order.status).toBe(SalesOrderStatus.FULFILLED);
    expect(h.order.saleId).toBeNull();
  });
});

describe('fulfilling to an off-platform customer', () => {
  it('sells the goods out of the chain instead of transferring them', async () => {
    const h = harness(offPlatformCustomer);

    await h.service.fulfil(SELLER as never, 5);

    // Nobody downstream can confirm receipt, so a transfer would strand the
    // stock IN_TRANSIT for ever.
    expect(h.transfers).toHaveLength(0);
    expect(h.sales.recordOffChainSale).toHaveBeenCalled();
    expect(h.order.saleId).toBe(77);
    expect(h.order.transferId).toBeNull();
    expect(h.order.status).toBe(SalesOrderStatus.FULFILLED);
  });

  it('anchors the sale to the customer code', async () => {
    const h = harness(offPlatformCustomer);

    await h.service.fulfil(SELLER as never, 5);

    const call = (h.sales.recordOffChainSale as jest.Mock).mock.calls[0];
    expect(call[3].consumerRef).toBe('CST-BBBB');
    expect(call[3].totalAmount).toBe('1200.00');
  });
});

describe('fulfilment guards', () => {
  it('refuses stock that is no longer reserved', async () => {
    const h = harness(registeredCustomer, ItemStatus.ACTIVE);

    await expect(h.service.fulfil(SELLER as never, 5)).rejects.toBeInstanceOf(
      TraceabilityRuleException,
    );
  });

  it('refuses an order that is not confirmed', async () => {
    const h = harness(registeredCustomer);
    h.order.status = SalesOrderStatus.PLACED;

    await expect(h.service.fulfil(SELLER as never, 5)).rejects.toBeInstanceOf(
      TraceabilityRuleException,
    );
  });
});

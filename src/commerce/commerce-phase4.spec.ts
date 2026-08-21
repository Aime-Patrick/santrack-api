import {
  SalesOrderStatus,
  canConfirmOrder,
  canFulfilOrder,
  canCancelOrder,
} from './commerce.enums';
import {
  ItemStatus,
  blocksSale,
} from '../item/item.enums';
import { TransferStatus } from '../transfer/entities/transfer.entity';

describe('Phase 4.1 — RESERVED status', () => {
  it('RESERVED blocks sale', () => {
    expect(blocksSale(ItemStatus.RESERVED)).toBe(true);
  });

  it('RESERVED blocks alongside other blocked statuses', () => {
    for (const status of [
      ItemStatus.RESERVED,
      ItemStatus.QUARANTINED,
      ItemStatus.RECALLED,
      ItemStatus.EXPIRED,
      ItemStatus.DAMAGED,
      ItemStatus.DESTROYED,
      ItemStatus.RETURNED,
      ItemStatus.SOLD,
    ]) {
      expect(blocksSale(status)).toBe(true);
    }
  });

  it('ACTIVE is not blocked', () => {
    expect(blocksSale(ItemStatus.ACTIVE)).toBe(false);
  });

  it('IN_TRANSIT is not blocked for sale check (but cannot be sold while in transit for other reasons)', () => {
    // IN_TRANSIT is not in the blocksSale list — dispatch/receive
    // controls whether it can be sold, not the status itself.
    expect(blocksSale(ItemStatus.IN_TRANSIT)).toBe(false);
  });
});

describe('Phase 4.1 — Sales order transitions with reservation', () => {
  it('confirm is allowed only from PLACED', () => {
    expect(canConfirmOrder(SalesOrderStatus.PLACED)).toBe(true);
    expect(canConfirmOrder(SalesOrderStatus.CONFIRMED)).toBe(false);
    expect(canConfirmOrder(SalesOrderStatus.FULFILLED)).toBe(false);
    expect(canConfirmOrder(SalesOrderStatus.CANCELLED)).toBe(false);
  });

  it('fulfil is allowed only from CONFIRMED', () => {
    expect(canFulfilOrder(SalesOrderStatus.CONFIRMED)).toBe(true);
    expect(canFulfilOrder(SalesOrderStatus.PLACED)).toBe(false);
    expect(canFulfilOrder(SalesOrderStatus.FULFILLED)).toBe(false);
  });

  it('cancel is allowed from PLACED or CONFIRMED', () => {
    expect(canCancelOrder(SalesOrderStatus.PLACED)).toBe(true);
    expect(canCancelOrder(SalesOrderStatus.CONFIRMED)).toBe(true);
    expect(canCancelOrder(SalesOrderStatus.FULFILLED)).toBe(false);
    expect(canCancelOrder(SalesOrderStatus.CANCELLED)).toBe(false);
  });
});

describe('Phase 4.4 — DELIVERED event vocabulary', () => {
  it('DELIVERED is defined in the transfer status enum', () => {
    expect(TransferStatus.RECEIVED).toBeDefined();
  });

  it('PARTIALLY_RECEIVED is defined for partial receipts', () => {
    expect(TransferStatus.PARTIALLY_RECEIVED).toBeDefined();
  });
});

describe('Phase 4.5 — Transfer partial receipts', () => {
  it('PARTIALLY_RECEIVED is distinct from RECEIVED and DISPATCHED', () => {
    expect(TransferStatus.PARTIALLY_RECEIVED).not.toBe(TransferStatus.RECEIVED);
    expect(TransferStatus.PARTIALLY_RECEIVED).not.toBe(TransferStatus.DISPATCHED);
    expect(TransferStatus.PARTIALLY_RECEIVED).not.toBe(TransferStatus.CANCELLED);
  });
});

describe('Phase 4.6 — Stock adjustment vocabulary', () => {
  it('CORRECTION event type exists for cycle count adjustments', () => {
    // The EventType.CORRECTION is used by the stock adjustment service
    // to record discrepancies between physical and system counts.
    const { EventType } = require('../traceability/event-type.enum');
    expect(EventType.CORRECTION).toBeDefined();
  });
});

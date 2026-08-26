import {
  PurchaseOrderStatus,
  canCancelPurchaseOrder,
  canConfirmPurchaseOrder,
  canReceivePurchaseOrder,
  canSendPurchaseOrder,
  computeTotals,
  lineTotal,
} from './purchasing.enums';

describe('purchase order transitions (DR-10)', () => {
  it('sends only from DRAFT', () => {
    expect(canSendPurchaseOrder(PurchaseOrderStatus.DRAFT)).toBe(true);
    expect(canSendPurchaseOrder(PurchaseOrderStatus.SENT)).toBe(false);
    expect(canSendPurchaseOrder(PurchaseOrderStatus.CONFIRMED)).toBe(false);
  });

  it('confirms only from SENT', () => {
    expect(canConfirmPurchaseOrder(PurchaseOrderStatus.SENT)).toBe(true);
    expect(canConfirmPurchaseOrder(PurchaseOrderStatus.DRAFT)).toBe(false);
    expect(canConfirmPurchaseOrder(PurchaseOrderStatus.CONFIRMED)).toBe(false);
  });

  it('cancels before receiving starts', () => {
    expect(canCancelPurchaseOrder(PurchaseOrderStatus.DRAFT)).toBe(true);
    expect(canCancelPurchaseOrder(PurchaseOrderStatus.SENT)).toBe(true);
    expect(canCancelPurchaseOrder(PurchaseOrderStatus.CONFIRMED)).toBe(true);
    expect(canCancelPurchaseOrder(PurchaseOrderStatus.RECEIVING)).toBe(false);
    expect(canCancelPurchaseOrder(PurchaseOrderStatus.CLOSED)).toBe(false);
  });

  it('receives from CONFIRMED or RECEIVING', () => {
    expect(canReceivePurchaseOrder(PurchaseOrderStatus.CONFIRMED)).toBe(true);
    expect(canReceivePurchaseOrder(PurchaseOrderStatus.RECEIVING)).toBe(true);
    expect(canReceivePurchaseOrder(PurchaseOrderStatus.SENT)).toBe(false);
    expect(canReceivePurchaseOrder(PurchaseOrderStatus.CLOSED)).toBe(false);
  });
});

describe('purchase order amounts', () => {
  it('computes line and document totals like commerce', () => {
    expect(lineTotal({ quantity: 10, unitPrice: 2.5 })).toBe(25);
    expect(computeTotals([{ quantity: 10, unitPrice: 2.5 }], 18)).toEqual({
      subtotal: '25',
      tax: '4.5',
      total: '29.5',
    });
  });
});

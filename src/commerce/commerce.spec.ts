import {
  CustomerSegment,
  CustomerType,
  InvoiceStatus,
  PaymentMethod,
  QuotationStatus,
  ReturnStatus,
  SalesOrderStatus,
  canAcceptQuotation,
  canApproveReturn,
  canCancelOrder,
  canConfirmOrder,
  canExpireQuotation,
  canFulfilOrder,
  canIssueInvoice,
  canRefundReturn,
  canRejectQuotation,
  canRejectReturn,
  canSendQuotation,
  canVoidInvoice,
  computeTotals,
  lineTotal,
  round2,
  subtotal,
  withTax,
} from './commerce.enums';

describe('quotation transitions (proposal section 6 workflow)', () => {
  it('sends only from DRAFT', () => {
    expect(canSendQuotation(QuotationStatus.DRAFT)).toBe(true);
    expect(canSendQuotation(QuotationStatus.SENT)).toBe(false);
    expect(canSendQuotation(QuotationStatus.ACCEPTED)).toBe(false);
  });

  it('accepts, rejects and expires only what has been sent', () => {
    expect(canAcceptQuotation(QuotationStatus.SENT)).toBe(true);
    expect(canAcceptQuotation(QuotationStatus.DRAFT)).toBe(false);
    expect(canRejectQuotation(QuotationStatus.SENT)).toBe(true);
    expect(canRejectQuotation(QuotationStatus.DRAFT)).toBe(false);
    expect(canExpireQuotation(QuotationStatus.SENT)).toBe(true);
    expect(canExpireQuotation(QuotationStatus.ACCEPTED)).toBe(false);
  });
});

describe('sales order transitions', () => {
  it('confirms only from PLACED', () => {
    expect(canConfirmOrder(SalesOrderStatus.PLACED)).toBe(true);
    expect(canConfirmOrder(SalesOrderStatus.CONFIRMED)).toBe(false);
    expect(canConfirmOrder(SalesOrderStatus.FULFILLED)).toBe(false);
  });

  it('fulfils only a confirmed order', () => {
    expect(canFulfilOrder(SalesOrderStatus.CONFIRMED)).toBe(true);
    expect(canFulfilOrder(SalesOrderStatus.PLACED)).toBe(false);
    expect(canFulfilOrder(SalesOrderStatus.FULFILLED)).toBe(false);
  });

  it('cancels only work that has not been fulfilled', () => {
    expect(canCancelOrder(SalesOrderStatus.PLACED)).toBe(true);
    expect(canCancelOrder(SalesOrderStatus.CONFIRMED)).toBe(true);
    expect(canCancelOrder(SalesOrderStatus.FULFILLED)).toBe(false);
  });
});

describe('invoice transitions', () => {
  it('issues only from DRAFT', () => {
    expect(canIssueInvoice(InvoiceStatus.DRAFT)).toBe(true);
    expect(canIssueInvoice(InvoiceStatus.ISSUED)).toBe(false);
    expect(canIssueInvoice(InvoiceStatus.PAID)).toBe(false);
  });

  it('voids only what has not been paid', () => {
    expect(canVoidInvoice(InvoiceStatus.DRAFT)).toBe(true);
    expect(canVoidInvoice(InvoiceStatus.ISSUED)).toBe(true);
    expect(canVoidInvoice(InvoiceStatus.PAID)).toBe(false);
    expect(canVoidInvoice(InvoiceStatus.VOID)).toBe(false);
  });
});

describe('return transitions', () => {
  it('approves and rejects only a requested return', () => {
    expect(canApproveReturn(ReturnStatus.REQUESTED)).toBe(true);
    expect(canRejectReturn(ReturnStatus.REQUESTED)).toBe(true);
    expect(canApproveReturn(ReturnStatus.APPROVED)).toBe(false);
    expect(canApproveReturn(ReturnStatus.REFUNDED)).toBe(false);
  });

  it('refunds only an approved return', () => {
    expect(canRefundReturn(ReturnStatus.APPROVED)).toBe(true);
    expect(canRefundReturn(ReturnStatus.REQUESTED)).toBe(false);
    expect(canRefundReturn(ReturnStatus.REFUNDED)).toBe(false);
  });
});

describe('commerce money', () => {
  it('rounds money to two decimals without floats', () => {
    expect(round2(12.345)).toBe(12.35);
    expect(round2(1.004)).toBe(1.0);
  });

  it('computes a line total from quantity and unit price', () => {
    expect(lineTotal({ quantity: 10, unitPrice: 2.5 })).toBe(25);
    expect(lineTotal({ quantity: 3, unitPrice: 9.99 })).toBe(29.97);
  });

  it('sums lines into a subtotal', () => {
    expect(subtotal([{ quantity: 2, unitPrice: 5 }, { quantity: 1, unitPrice: 3.5 }])).toBe(13.5);
  });

  it('applies a tax percentage to the subtotal', () => {
    expect(withTax(100, 18)).toBe(118);
    expect(withTax(50, 0)).toBe(50);
  });

  it('computes document totals with tax from lines', () => {
    const totals = computeTotals(
      [
        { quantity: 2, unitPrice: 10 },
        { quantity: 1, unitPrice: 5 },
      ],
      10,
    );
    expect(totals.subtotal).toBe('25');
    expect(totals.tax).toBe('2.5');
    expect(totals.total).toBe('27.5');
  });
});

describe('commerce vocabulary', () => {
  it('covers customer segmentation', () => {
    expect(CustomerType.BUSINESS).toBeDefined();
    expect(CustomerType.CONSUMER).toBeDefined();
    expect(CustomerSegment.KEY_ACCOUNT).toBe('KEY_ACCOUNT');
    expect(CustomerSegment.WHOLESALE).toBe('WHOLESALE');
  });

  it('covers payment methods', () => {
    expect(PaymentMethod.MOBILE_MONEY).toBe('MOBILE_MONEY');
    expect(PaymentMethod.BANK_TRANSFER).toBe('BANK_TRANSFER');
  });
});
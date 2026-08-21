/**
 * Commercial layer vocabulary (technical proposal section 6): customers,
 * quotations, sales orders, invoices, payments, returns and credit. The
 * existing sale module moves physical stock; this module is the paper trail
 * that drives it - who bought what, on which terms, and what they still owe.
 *
 * The transition guards are the workflow in one table, so services state what
 * they allow and the tests pin the rules down without a database.
 */

export enum CustomerType {
  /** An account a company keeps for a business it sells to. */
  BUSINESS = 'BUSINESS',
  /** A walk-in final customer, kept for sales history only. */
  CONSUMER = 'CONSUMER',
}

/** The segmentation a seller uses to price and prioritise customers. */
export enum CustomerSegment {
  RETAIL = 'RETAIL',
  WHOLESALE = 'WHOLESALE',
  PREMIUM = 'PREMIUM',
  KEY_ACCOUNT = 'KEY_ACCOUNT',
}

export enum QuotationStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum SalesOrderStatus {
  PLACED = 'PLACED',
  CONFIRMED = 'CONFIRMED',
  FULFILLED = 'FULFILLED',
  CANCELLED = 'CANCELLED',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  VOID = 'VOID',
}

export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  MOBILE_MONEY = 'MOBILE_MONEY',
  CHEQUE = 'CHEQUE',
  CARD = 'CARD',
}

export enum ReturnStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REFUNDED = 'REFUNDED',
  REJECTED = 'REJECTED',
}

// ------------------------------------------------------- transition guards

export function canSendQuotation(status: QuotationStatus): boolean {
  return status === QuotationStatus.DRAFT;
}

export function canAcceptQuotation(status: QuotationStatus): boolean {
  return status === QuotationStatus.SENT;
}

export function canRejectQuotation(status: QuotationStatus): boolean {
  return status === QuotationStatus.SENT;
}

export function canExpireQuotation(status: QuotationStatus): boolean {
  return status === QuotationStatus.SENT;
}

export function canConfirmOrder(status: SalesOrderStatus): boolean {
  return status === SalesOrderStatus.PLACED;
}

export function canFulfilOrder(status: SalesOrderStatus): boolean {
  return status === SalesOrderStatus.CONFIRMED;
}

export function canCancelOrder(status: SalesOrderStatus): boolean {
  return (
    status === SalesOrderStatus.PLACED ||
    status === SalesOrderStatus.CONFIRMED
  );
}

export function canIssueInvoice(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.DRAFT;
}

export function canVoidInvoice(status: InvoiceStatus): boolean {
  return (
    status === InvoiceStatus.DRAFT || status === InvoiceStatus.ISSUED
  );
}

export function canApproveReturn(status: ReturnStatus): boolean {
  return status === ReturnStatus.REQUESTED;
}

export function canRejectReturn(status: ReturnStatus): boolean {
  return status === ReturnStatus.REQUESTED;
}

export function canRefundReturn(status: ReturnStatus): boolean {
  return status === ReturnStatus.APPROVED;
}

// -------------------------------------------------------------- amounts

/** Rounds money to two decimals without ever passing through a float. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface AmountLine {
  quantity: number;
  unitPrice: number;
}

export function lineTotal(line: AmountLine): number {
  return round2(line.quantity * line.unitPrice);
}

export function subtotal(lines: AmountLine[]): number {
  return round2(lines.reduce((sum, line) => sum + lineTotal(line), 0));
}

export function withTax(subtotalValue: number, taxPercent: number): number {
  return round2(subtotalValue * (1 + taxPercent / 100));
}

/** A document's money, from its lines and an optional tax percentage. */
export function computeTotals(
  lines: AmountLine[],
  taxPercent: number,
): { subtotal: string; tax: string; total: string } {
  const base = subtotal(lines);
  const tax = taxPercent ? withTax(base, taxPercent) - base : 0;
  const total = base + tax;
  return {
    subtotal: String(base),
    tax: String(round2(tax)),
    total: String(round2(total)),
  };
}
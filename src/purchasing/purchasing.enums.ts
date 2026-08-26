/**
 * Purchasing vocabulary (DR-10): suppliers and purchase orders for
 * finished-goods inbound. Physical stock still moves through Transfer
 * receive; these documents are the buyer's commercial paper trail.
 *
 * Transition guards are the workflow in one table so services state what
 * they allow and tests can pin the rules without a database.
 */

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  CONFIRMED = 'CONFIRMED',
  RECEIVING = 'RECEIVING',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

// ------------------------------------------------------- transition guards

export function canSendPurchaseOrder(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.DRAFT;
}

export function canConfirmPurchaseOrder(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.SENT;
}

export function canCancelPurchaseOrder(status: PurchaseOrderStatus): boolean {
  return (
    status === PurchaseOrderStatus.DRAFT ||
    status === PurchaseOrderStatus.SENT ||
    status === PurchaseOrderStatus.CONFIRMED
  );
}

/** Receive is allowed once confirmed, including partial receiving. */
export function canReceivePurchaseOrder(status: PurchaseOrderStatus): boolean {
  return (
    status === PurchaseOrderStatus.CONFIRMED ||
    status === PurchaseOrderStatus.RECEIVING
  );
}

// -------------------------------------------------------------- amounts
// Same money helpers as commerce — keep purchasing totals consistent.

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

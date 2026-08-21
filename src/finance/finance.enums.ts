/**
 * Finance vocabulary (technical proposal section 7): the general ledger.
 * Operational transactions - purchases, production, sales, payroll, expenses
 * - post into a double-entry journal here, and the reports (profit and loss,
 * balances, cash) read the ledger rather than a parallel spreadsheet.
 *
 * The transition guards and balance helpers are the accounting rules in one
 * table, so services state what they allow and the tests pin them down.
 */

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

/**
 * A journal entry is balanced when the debits equal the credits. Every line
 * moves exactly one side, and no entry stands on a single line.
 */
export function isBalanced(
  lines: { debit: number; credit: number }[],
): boolean {
  if (lines.length < 2) return false;
  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    if (line.debit < 0 || line.credit < 0) return false;
    if (line.debit > 0 && line.credit > 0) return false;
    debits += line.debit;
    credits += line.credit;
  }
  return Math.abs(round2(debits) - round2(credits)) < 0.001;
}

/** Whether an account's normal, growing side is a debit. */
export function isDebitNormal(type: AccountType): boolean {
  return type === AccountType.ASSET || type === AccountType.EXPENSE;
}

/** Rounds money to two decimals without ever passing through a float. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
import { AccountType, isBalanced, isDebitNormal } from './finance.enums';

describe('journal balancing (proposal section 7)', () => {
  it('accepts a two-sided entry that sums to zero', () => {
    expect(
      isBalanced([
        { debit: 100, credit: 0 },
        { debit: 0, credit: 100 },
      ]),
    ).toBe(true);
  });

  it('rejects an entry whose debits do not match its credits', () => {
    expect(
      isBalanced([
        { debit: 100, credit: 0 },
        { debit: 0, credit: 90 },
      ]),
    ).toBe(false);
  });

  it('rejects a single-line entry', () => {
    expect(isBalanced([{ debit: 100, credit: 0 }])).toBe(false);
  });

  it('rejects a line that moves both sides at once', () => {
    expect(
      isBalanced([
        { debit: 100, credit: 50 },
        { debit: 0, credit: 50 },
      ]),
    ).toBe(false);
  });

  it('rejects negative amounts', () => {
    expect(
      isBalanced([
        { debit: -10, credit: 0 },
        { debit: 0, credit: -10 },
      ]),
    ).toBe(false);
  });

  it('tolerates the rounding noise that a float sum would produce', () => {
    expect(
      isBalanced([
        { debit: 0.1, credit: 0 },
        { debit: 0.2, credit: 0 },
        { debit: 0, credit: 0.3 },
      ]),
    ).toBe(true);
  });
});

describe('account balance direction', () => {
  it('grows assets and expenses on the debit side', () => {
    expect(isDebitNormal(AccountType.ASSET)).toBe(true);
    expect(isDebitNormal(AccountType.EXPENSE)).toBe(true);
  });

  it('grows liabilities, equity and revenue on the credit side', () => {
    expect(isDebitNormal(AccountType.LIABILITY)).toBe(false);
    expect(isDebitNormal(AccountType.EQUITY)).toBe(false);
    expect(isDebitNormal(AccountType.REVENUE)).toBe(false);
  });
});
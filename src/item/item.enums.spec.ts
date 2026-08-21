import { TraceableItem } from './entities/traceable-item.entity';
import { ItemStatus, blocksSale, isTerminal } from './item.enums';

describe('sale blocking (business rule 11)', () => {
  const blocked = [
    ItemStatus.QUARANTINED,
    ItemStatus.RECALLED,
    ItemStatus.EXPIRED,
    ItemStatus.DAMAGED,
    ItemStatus.DESTROYED,
    ItemStatus.SOLD,
    ItemStatus.RETURNED,
  ];

  it.each(blocked)('refuses to sell %s stock', (status) => {
    expect(blocksSale(status)).toBe(true);
  });

  it('allows active stock to be sold', () => {
    expect(blocksSale(ItemStatus.ACTIVE)).toBe(false);
  });

  /**
   * In transit is not in this list on purpose: goods travelling to a buyer are
   * refused earlier, with a message that says they have not arrived yet, which
   * is a more useful answer than "cannot be sold".
   */
  it('does not treat in-transit as a permanent block', () => {
    expect(blocksSale(ItemStatus.IN_TRANSIT)).toBe(false);
  });

  it('treats returned stock as blocked until it is released', () => {
    // The return workflow exists so goods coming back up the chain are
    // inspected before they are sold again.
    expect(blocksSale(ItemStatus.RETURNED)).toBe(true);
  });

  it('only destroyed is terminal', () => {
    expect(isTerminal(ItemStatus.DESTROYED)).toBe(true);
    expect(isTerminal(ItemStatus.RECALLED)).toBe(false);
    expect(isTerminal(ItemStatus.SOLD)).toBe(false);
  });
});

describe('expiry', () => {
  function itemExpiring(on: string | null): TraceableItem {
    const item = new TraceableItem();
    item.expiresOn = on;
    return item;
  }

  it('is not expired on the expiry date itself', () => {
    // A carton marked "use by 20 Aug" is still good all through 20 Aug.
    expect(itemExpiring('2026-08-20').isExpired('2026-08-20')).toBe(false);
  });

  it('is expired the day after', () => {
    expect(itemExpiring('2026-08-20').isExpired('2026-08-21')).toBe(true);
  });

  it('never expires when no date was recorded', () => {
    expect(itemExpiring(null).isExpired('2099-01-01')).toBe(false);
  });

  it('compares correctly across month and year boundaries', () => {
    expect(itemExpiring('2026-08-31').isExpired('2026-09-01')).toBe(true);
    expect(itemExpiring('2026-12-31').isExpired('2027-01-01')).toBe(true);
    expect(itemExpiring('2027-01-01').isExpired('2026-12-31')).toBe(false);
  });
});

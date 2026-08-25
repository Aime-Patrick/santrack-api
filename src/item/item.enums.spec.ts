import { TraceableItem } from './entities/traceable-item.entity';
import {
  ItemStatus,
  blocksSale,
  existsPhysically,
  isPreProduction,
  isTerminal,
} from './item.enums';

describe('sale blocking (business rule 11)', () => {
  const blocked = [
    ItemStatus.QUARANTINED,
    ItemStatus.RECALLED,
    ItemStatus.EXPIRED,
    ItemStatus.DAMAGED,
    ItemStatus.DESTROYED,
    ItemStatus.SOLD,
    ItemStatus.RETURNED,
    ItemStatus.GENERATED,
    ItemStatus.ASSIGNED,
    ItemStatus.CANCELLED,
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

  /**
   * The reason this is an allowlist rather than a denylist. A status nobody
   * thought about must refuse the sale, not permit it - the cost of forgetting
   * one is a blocked sale somebody complains about, not ten thousand
   * unproduced bottles sold.
   */
  it('refuses any status not explicitly declared sellable', () => {
    const invented = 'SOME_STATUS_ADDED_LATER' as ItemStatus;
    expect(blocksSale(invented)).toBe(true);
  });

  it('destroyed and cancelled are terminal', () => {
    expect(isTerminal(ItemStatus.DESTROYED)).toBe(true);
    expect(isTerminal(ItemStatus.CANCELLED)).toBe(true);
    expect(isTerminal(ItemStatus.RECALLED)).toBe(false);
    expect(isTerminal(ItemStatus.SOLD)).toBe(false);
  });
});

/**
 * An identity is minted before the product it names exists (DR-08), so for
 * part of its life the code is real and the bottle is not. Every count of
 * stock depends on telling those apart.
 */
describe('identities that name no physical thing', () => {
  const nothingExistsYet = [
    ItemStatus.GENERATED,
    ItemStatus.ASSIGNED,
    ItemStatus.CANCELLED,
  ];

  it.each(nothingExistsYet)('has no physical product under %s', (status) => {
    expect(existsPhysically(status)).toBe(false);
  });

  it('has a physical product once production confirms it', () => {
    expect(existsPhysically(ItemStatus.ACTIVE)).toBe(true);
  });

  /**
   * A destroyed bottle was a real bottle. A cancelled code never was, and the
   * consumer scanning it has to be told a different thing.
   */
  it('separates a product that was destroyed from a code that never became one', () => {
    expect(existsPhysically(ItemStatus.DESTROYED)).toBe(true);
    expect(existsPhysically(ItemStatus.CANCELLED)).toBe(false);
  });

  it('counts generated and assigned codes as awaiting production', () => {
    expect(isPreProduction(ItemStatus.GENERATED)).toBe(true);
    expect(isPreProduction(ItemStatus.ASSIGNED)).toBe(true);
  });

  it('does not count a cancelled code as awaiting production', () => {
    // It is finished, not pending: no run will ever produce it.
    expect(isPreProduction(ItemStatus.CANCELLED)).toBe(false);
    expect(isPreProduction(ItemStatus.ACTIVE)).toBe(false);
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

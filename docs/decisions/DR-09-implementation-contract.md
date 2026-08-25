# SANTRACK · DR-09 · Implementation Contract & Migration Plan

**Status:** APPROVED — D1, D2, D3 signed 25 Aug 2026. **No code, schema, migration or
frontend has been written.** This document is the contract that code will be checked against,
not the code.

**Governing decision record:** `DR-09-sales-units-and-identity-granularity.md`.

**Depends on:** DR-01 (traceability level), DR-08 (identity pool lifecycle).

**The rule this document preserves — amended 25 Aug 2026.**

The first draft of this contract said flatly that nothing in `item/`, `inventory/`,
`traceability/` or `manufacturing/` changes. That was carried over from the sales boundary in
the audit, where it was the right rule for sales work, and it was wrong here: Phase 1 is
foundation repair, and the pool defect it exists to fix *lives* in `item/`. As originally
written this contract made WU-1 impossible to execute. The boundary is therefore scoped by
phase rather than applied flatly:

| Work units | May touch | Must not touch |
| --- | --- | --- |
| **WU-1 – WU-3** (foundation) | `product/`, and `item/` **only within the explicitly scoped work unit below** | `inventory/`, `manufacturing/`, behavioural logic in `traceability/` |
| **WU-4 onward** (sales layer) | `commerce/`, `auth/`, `sale/`, frontend | `item/`, `inventory/`, `manufacturing/`, behavioural logic in `traceability/` |

The one permitted `item/` edit in the whole contract is **WU-1's refusal guard in
`IdentityPoolService.request()`** and its test. Nothing else in `item/` moves: not identity
shape, not minting behaviour for valid `SERIAL` products, not assignment, not production
confirmation, not cancellation, not any lifecycle transition.

`traceability/` is untouched except **WU-6's doc comment on `EventType.RELEASED`**, which
changes no behaviour. `inventory/` and `manufacturing/` are untouched by every work unit.

---

## 1. Scope lock

**In scope.** Phase 1 (identity foundation) and Phase 2 (the three chain blockers). Seven
work units across `product/`, `item/`, `commerce/`, `auth/` and the sales frontend.

**Out of scope, named so they cannot arrive by accident.** A unit-of-measure conversion
engine; multi-level pack tiers; per-customer units; price lists, discounts, currency, tax
codes; point of sale; purchasing and suppliers; backorders and split shipments; ledger
posting; commission and territories; opening stock for non-manufacturers (DR-09 D3); any
split operation on an identity.

**Payment is out of the acceptance criteria.** Every done-condition below is a physical
movement outcome — status, holder, location, event, document. The chain must be demonstrable
end to end with nothing paid.

---

## 2. Three traps found while writing this contract

**Trap 1 — `confirm()` checks credit before it knows the amount.** `requireCredit()` runs at
`sales-order.service.ts:132`, before any reservation. Order totals are computed at `create()`
from the requested quantity. If the customer is billed for what they receive, the total is
provisional until confirmation, and a customer can be approved for 2,000 and invoiced for
2,016 above their ceiling. WU-5 reorders `confirm()` to reserve → compute fulfilment total →
check credit.

**Trap 2 — `Product` has no unit of measure at all.** `TraceableItem.quantity` is a
dimensionless integer, so "2,016" is a number with no noun. `RawMaterial` already carries a
non-null `unit_of_measure`, so the house pattern exists; the catalogue never adopted it. WU-2
adds it, display-only.

**Trap 3 — `toAmountLine()` exists twice.** Both `sales-order.service.ts:485` and
`quotation.service.ts:213` read `line.quantity`. Renaming the column touches both, and
missing one leaves a service silently computing totals from `undefined`.

---

## 3. Migration plan

Two migrations, both forward-only in effect and both individually revertible.

### M1 — `ProductSalesUnits`

```
ALTER TABLE products ADD COLUMN base_unit      varchar NULL;
ALTER TABLE products ADD COLUMN pack_unit      varchar NULL;
ALTER TABLE products ADD COLUMN units_per_pack integer NULL;
```

No backfill. Null `base_unit` means the UI shows a bare number as it does today; no
`pack_unit` means only the base unit may be sold in.

### M2 — `SalesUnitAndFulfilment`

```
ALTER TABLE sales_order_lines RENAME COLUMN quantity TO requested_quantity;
ALTER TABLE sales_order_lines ADD COLUMN sales_unit          varchar NULL;
ALTER TABLE sales_order_lines ADD COLUMN fulfilment_quantity numeric(14,3) NULL;
ALTER TABLE quotation_lines   RENAME COLUMN quantity TO requested_quantity;
ALTER TABLE quotation_lines   ADD COLUMN sales_unit varchar NULL;
ALTER TABLE sales_orders      ADD COLUMN rounding_accepted_at timestamptz NULL;
ALTER TABLE sales_orders      ADD COLUMN rounding_accepted_by_id integer NULL REFERENCES users(id);
```

**Backfill honestly.** `fulfilment_quantity` = `requested_quantity` for existing rows;
`sales_unit` stays **null**. Historic lines were entered in an unstated unit and inventing one
would be a claim nobody made. Null `sales_unit` is read as "the product's base unit" by
display code and is never used for conversion.

---

## 4. Interface contracts

```ts
// product/traceability-level.enum.ts
/** Whether a pool of one-unit codes is meaningful for this level (DR-09 §Context fact 3). */
export function permitsIdentityPool(level: TraceabilityLevel): boolean;

// product/sales-unit.ts  (new file)
/** The units this product may be sold in: its base unit, plus its pack if declared. */
export function sellableUnits(product: Product): string[];

/** Product units per one of `salesUnit`. Throws for a unit the product does not offer. */
export function unitsPerSalesUnit(product: Product, salesUnit: string): number;

/**
 * Whether this line may be entered at all (DR-09 §Sales unit availability).
 * Returns true, or the sentence explaining the refusal — never a bare boolean false,
 * because every refusal here has to be explainable to a salesperson mid-quote.
 */
export function salesUnitPermitted(
  product: Product,
  salesUnit: string,
  requestedQuantity: number,
): true | string;
```

`salesUnitPermitted` is pure and takes no `EntityManager`, matching how `commerce.enums.ts`,
`manufacturing.enums.ts` and `batch-status.enum.ts` already express guards — so the whole rule
table is unit-testable with no database.

---

## 5. Work units

Each is independently testable and independently revertible. Dependencies are named.

### WU-1 · Pools refuse non-`SERIAL` products
**Depends on:** nothing.
**Files:** `product/traceability-level.enum.ts` (add `permitsIdentityPool`),
`item/services/identity-pool.service.ts` (`request()` guard),
`item/traceability-level.spec.ts`.
**Done when:** requesting a pool for a `BATCH`- or `PACKAGE`-traced product is refused with a
sentence naming the level; the two stock-in doors can no longer disagree about what a
traceability level means.
**Tests:** the predicate for all three levels · `request()` refuses `BATCH` · `request()`
still succeeds for `SERIAL`.
**Revert:** delete the guard. No data shape changes.

### WU-2 · `Product` unit columns + M1
**Depends on:** nothing.
**Files:** `product/entities/product.entity.ts`, `product/dto/product.dto.ts`,
`product/services/product.service.ts`, `migrations/<ts>-ProductSalesUnits.ts`.
**Done when:** a product can declare `baseUnit`, `packUnit` and `unitsPerPack`; the service
refuses a `packUnit` without a `unitsPerPack` and vice versa, and refuses `unitsPerPack < 2` —
a pack of one is a base unit with a second name. Entity doc comments state plainly that none
of the three is stock truth.
**Tests:** pack set together · pack half-set refused · `unitsPerPack` of 1 refused · all three
null is valid.
**Revert:** M1 `down()`. Nothing reads the columns yet.

### WU-3 · `sellableUnits` / `unitsPerSalesUnit` / `salesUnitPermitted`
**Depends on:** WU-2.
**Files:** `product/sales-unit.ts` (new), `product/sales-unit.spec.ts` (new).
**Done when:** DR-09 invariants 4, 5 and 6 hold as pure unit tests with no database.
**Tests:** base unit accepted · pack unit accepted where declared · pack unit refused where not
declared · an unrelated unit refused · `BATCH` with a partial quantity refused, and the
returned sentence says *partial fulfilment of a batch-traced product is not supported* rather
than anything about stock levels · `BATCH` for the whole lot accepted.
**Revert:** delete both files.

### WU-4 · Line shape + M2
**Depends on:** WU-3.
**Files:** `commerce/entities/sales-order.entity.ts`, `commerce/entities/quotation.entity.ts`,
`commerce/dto/quotation.dto.ts`, `commerce/services/quotation.service.ts` (`toAmountLine`,
`saveLine`), `commerce/services/sales-order.service.ts` (`toAmountLine`, `saveLine`),
`migrations/<ts>-SalesUnitAndFulfilment.ts`.
**Done when:** a line stores `salesUnit`, `requestedQuantity` and `fulfilmentQuantity`;
`saveLine()` calls `salesUnitPermitted()` and refuses with its sentence; both copies of
`toAmountLine()` read the renamed field (trap 3); existing rows survive the rename with
`sales_unit` null.
**Tests:** line entry refused for an incompatible unit · quotation line carries `salesUnit` and
no fulfilment quantity · a quotation converted to an order carries the unit across · backfilled
rows read correctly.
**Revert:** M2 `down()` restores `quantity`. Both services revert as one unit.

### WU-5 · Reservation in units, credit after fulfilment
**Depends on:** WU-4. **Blocker.**
**Files:** `commerce/services/sales-order.service.ts` (`reserveLine`, `confirm`),
`commerce/services/sales-order.service.spec.ts`.
**Done when:** `reserveLine()` accumulates `SUM(item.quantity)` until `requestedQuantity` is
covered, writes the true quantity on each `SalesOrderReservation` row rather than 1, and sets
the line's `fulfilmentQuantity`; `confirm()` runs reserve → compute fulfilment total → 
`requireCredit()` (trap 1); a short line reports the shortfall in product units, not identity
count. DR-09 invariants 3 and 8 hold.
**Tests:** `SERIAL` singles · packed cartons reserving 84 identities for 2,016 units · exact-fit
`CARTON` order with no rounding · short line message states units · credit ceiling tested
against the fulfilment total, not the requested one.
**Revert:** revert the method. `SalesOrderReservation.quantity` already exists as an int column
defaulting to 1, so no migration is involved either way.

### WU-6 · Release on cancel
**Depends on:** WU-5. **Blocker.**
**Files:** `commerce/services/sales-order.service.ts` (`cancel`, new `release`),
`commerce/controllers/sales-order.controller.ts` (`POST :id/release`, `MANAGE_CLIENTS`),
`traceability/event-type.enum.ts` (**doc comment only**), a one-off reconciliation script.
**Event type:** reuse `EventType.RELEASED` and widen its doc comment. Adding an enum member
means altering a Postgres enum type in a migration, which is not worth it for a transition
`RELEASED` already describes — goods going back into normal stock.
**Done when:** cancelling a confirmed order returns every reserved identity to `ACTIVE` and
appends a `RELEASED` event; reservation rows are not deleted (DR-09 invariant 9); dispatch,
relocate and sell all accept the released goods again.
**Tests:** cancel releases all · release endpoint releases without cancelling · a released
identity is dispatchable · reservation rows survive.
**Revert:** revert the methods and drop the route. Already-released stock stays released, which
is the safe direction.
**Note:** the reconciliation script is required, not optional. Any cancelled confirmed order in
a live database has already stranded its stock permanently.

### WU-7 · Retailers and shops can receive
**Depends on:** nothing. **Blocker. Do this one first — two arrows are dead without it.**
**Files:** `auth/capabilities.ts`, `auth/capabilities.spec.ts`.
**Change:** `RETAILER` ceiling gains `MOVE_STOCK`. `SHOP` ceiling gains `MOVE_STOCK` and
`APPLY_LIFECYCLE`.
**Why `MOVE_STOCK` rather than a narrower `RECEIVE_STOCK`:** its own description is already
"dispatch stock to another party, confirm receipt, and relocate it internally", and a shop
genuinely does all three — takes deliveries, moves stock from stockroom to shelf, sends goods
back up the chain. A new capability would fit the demo more precisely and describe the business
worse. Accepted cost: a shop can dispatch to another party, which shops legitimately do.
`APPLY_LIFECYCLE` is not optional — without it a shop can never record damaged, expired or
returned stock, and the return arrow cannot work.
**Done when:** a `SHOP` user can call `POST /api/transfers/:id/receive`; holder moves, status
goes `IN_TRANSIT → ACTIVE`, a `RECEIVED` event is written, the transfer closes.
**Tests:** both ceilings pinned in `capabilities.spec.ts` — that file is the single source of
truth for the platform, so the test *is* the specification.
**Revert:** revert the two ceiling entries.

### WU-8 · Frontend — three quantities on screen
**Depends on:** WU-5.
**Files:** `tracer/frontend/src/components/sales/sales-orders-panel.tsx`,
`src/services/commerce.service.ts`, `src/hooks/commerce.ts`,
`src/app/dashboard/products/[id]` (unit fields).
**Done when:** the order form offers only `sellableUnits(product)`; the line shows
**"2,000 bottles requested → 84 cartons / 2,016 bottles to fulfil"**; rounding acceptance is an
explicit control before confirm, never a silent recalculation; a refused sales unit shows the
sentence from `salesUnitPermitted()`, not a generic validation error.
**Note:** new surfaces are tabs, panels or actions on existing screens. The sales area was
already consolidated into one tabbed workspace with the old routes reduced to redirects; no new
sidebar entries.
**Revert:** revert the components.

---

## 6. Order of work

```
WU-7  ── unblocks the chain, independent, do first
WU-1  ── independent
WU-2 → WU-3 → WU-4 → WU-5 → WU-6
                            └→ WU-8
```

---

## 7. Invariant → verification map

| DR-09 invariant | Verified by |
| --- | --- |
| 1 · identity `quantity` never mutated by sales code | WU-5 tests; also by the boundary rule in §1 |
| 2 · `requestedQuantity` written once | WU-4, WU-5 tests |
| 3 · `fulfilmentQuantity` = SUM over reservations | WU-5 tests |
| 4 · `salesUnit` ∈ {`baseUnit`, `packUnit`} | WU-3 pure tests, enforced at WU-4 |
| 5 · pack columns set together, `unitsPerPack >= 2` | WU-2 tests |
| 6 · partial `BATCH` refused with its own sentence | WU-3 tests |
| 7 · unit columns never read by stock queries | §1 boundary rule; no change in `inventory/` |
| 8 · reservation reserves whole identities only | WU-5 tests |
| 9 · release appends, never deletes | WU-6 tests |
| 10 · payment gates no custody transition | §1 scope lock; `fulfil()` has no invoice check today and must keep none |

---

## 8. Regression surface

- `InventoryService.positions()` — must return identical figures before and after. It reads
  `holder_id`, `status`, `quantity` and leaf-ness, none of which any work unit touches.
- `SaleService.requireSellable()` — `RESERVED` must keep blocking a sale; WU-6 only adds a way
  out of that state.
- `TransferService.dispatch()` / `relocate()` — both refuse `RESERVED` today and must continue
  to.
- `NON_PHYSICAL_STATUSES` filtering — untouched, and every new query must reuse the constant.
- `GET /api/verify/:token` — untouched. No sales field may reach it.
- Existing quotations and orders — must survive M2's rename with `sales_unit` null and render
  correctly.

---

## 9. Stop condition

Stop and re-open DR-09 on any of these:

- a behavioural change in `inventory/`, `traceability/` or `manufacturing/`;
- any change in `item/` beyond WU-1's refusal guard and its test;
- a sales work unit (WU-4 onward) needing to reach into `item/` at all.

The last is the one this boundary exists for: it means the sales layer is reaching into the
identity model, which is the failure the whole design was drawn to prevent.

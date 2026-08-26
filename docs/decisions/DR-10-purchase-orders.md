# DR-10: Purchase Orders (Finished-Goods Inbound v1)

**Status:** APPROVED for v1 finished-goods inbound between platform orgs.

**Depends on:** Commerce customers / sales orders (seller side), Transfer receive
(physical inbound), product catalogue (buyer-owned products).

---

## Context & Problem Statement

Commerce today models the **seller** side: Customer → Quotation → SalesOrder →
Invoice. A distributor or retailer that buys finished goods from another
platform organization has no buyer-side commercial document. Physical inbound
already works through Transfer receive (`MOVE_STOCK`); what is missing is the
purchase order paper trail that says *who we ordered from, what we expected, and
how much of that expectation we have booked as received*.

---

## Decision

### D1 — Supplier directory (org-scoped)

The buyer maintains a **Supplier** directory under its own organization:

| Field | Role |
| --- | --- |
| `code`, `name` | Stable directory identity within the buyer org |
| `linkedOrganizationId` | Optional: the seller's organization when that seller is on the platform |
| `contact`, `phone`, `email` | Soft contact fields |
| `active` | Soft-disable without deleting history |

`linkedOrganizationId` is never inferred from name or email. Pointing it at the
buyer's own organization is refused (same self-hand-off rule as customers).

### D2 — Purchase order lifecycle

```
DRAFT → SENT → CONFIRMED → RECEIVING → CLOSED
                ↘ CANCELLED (from DRAFT / SENT / CONFIRMED)
```

| Transition | Meaning |
| --- | --- |
| Create | Buyer raises a PO against a supplier; status `DRAFT` |
| Send | Buyer issues the PO commercially (`SENT`) |
| Confirm | Supplier / buyer acknowledges the deal (`CONFIRMED`). **Does not move stock.** |
| Receive | Buyer records line `receivedQuantity`; status becomes `RECEIVING`, then `CLOSED` when every line is fully received |
| Cancel | Aborts before receiving starts |

### D3 — Lines and catalogue

Every line requires `productId` from the **buyer's** product catalogue. When the
buyer resells, that is the catalogue row they will stock. First receive of
unknown goods still needs a buyer catalogue product first — keep v1 simple; do
not accept seller product ids or invent catalogue rows on receive.

Line money: `quantity`, `unit_price`, `line_total`; header `subtotal`,
`tax_percent`, `total_amount` (same rounding helpers as commerce).

### D4 — Receive is commercial paper only (v1)

**Simplest v1:** PO is commercial paper + status. `receive` updates
`received_quantity` on lines and closes the PO when complete.

Physical stock still moves only through the existing **Transfer receive** path
(`MOVE_STOCK`). Confirm never creates transfers, reserves, or identities.
Future work may link a PO to identities already `IN_TRANSIT` to the buyer, or
create a Transfer from a seller org when `linkedOrganizationId` is set and the
seller has fulfilled an SO — that is **out of scope for v1**.

Document for operators: booking receive on the PO does not put goods on hand;
warehouse receive on the transfer does.

### D5 — Authorization

| Action | Capability |
| --- | --- |
| Writes (suppliers + PO mutations) | `MANAGE_CLIENTS` (reuse) |
| Reads | `VIEW_OPERATIONS` |

**Org ceilings:** manufacturer, distributor, retailer, shop. Warehouse and
regulator do not hold `MANAGE_CLIENTS` under existing ceilings; purchasing
writes are therefore already out of reach for those types. Services may also
refuse non-trading org types explicitly for clear errors.

### D6 — Out of scope (v1)

- Raw materials on-hand / manufacturing procurement
- Auto-creation of a seller Sales Order from a buyer PO
- Price lists / negotiated catalogues
- Stock movement, identity selection, or Transfer creation from receive

---

## Consequences

- New tables: `suppliers`, `purchase_orders`, `purchase_order_lines`.
- API under `api/purchasing/suppliers` and `api/purchasing/orders`.
- Physical inbound UX remains Transfer-centric; PO screens show commercial
  progress only until a later DR couples them.

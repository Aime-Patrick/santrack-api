# santrack-api

The SANTRACK central API — product traceability, packaging, inventory,
transfers, sales, recall and verification.

NestJS + TypeORM + PostgreSQL, per section 14 of the technical proposal. This
service replaces the Java `stock-api`, which remains in the repository
untouched until this port is verified against a running database.

## Running it

The repo-root `docker-compose.yml` Postgres was first initialised with the
`stock_manager` database for the Java service. `POSTGRES_DB` only takes effect
on an empty volume, so SANTRACK's database is created separately rather than by
editing that shared file.

```bash
docker compose up -d          # from the repo root
pnpm install
pnpm db:setup                 # creates the santrack database if absent
pnpm migration:run            # applies the schema
pnpm start:dev                # http://localhost:8081
```

## Deploy on Render

This API is meant for [Render](https://render.com) (not Vercel): NestJS, Postgres,
Redis/BullMQ, Socket.IO and scheduled jobs need a long-running Node process.

1. Push this repo to GitHub/GitLab.
2. In Render: **New → Blueprint** → select the repo (uses `render.yaml`).
3. When prompted, set:
   - `CORS_ORIGINS` — your frontend origin(s), e.g. `https://your-app.vercel.app`
   - `APP_PUBLIC_URL` — same origin (used in invite / reset email links)
4. Deploy. Start runs migrations then `node dist/main.js`.
5. Health check: `GET /api/health` → `{ "status": "ok" }`.
6. Point the frontend API base URL at your Render service URL
   (e.g. `https://santrack-api.onrender.com`).

Free-tier notes: the web service spins down when idle (cold starts); Postgres and
Key Value free instances expire if unused for a stretch — fine for demos, not for
production. Upgrade plans when you go live.

Optional email on Render: add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
on the web service if you want real mail instead of a no-op SMTP setup.

## Conformance suite

`stock-api/scripts/traceability-walkthrough.mjs` talks plain HTTP and has no
dependency on the old stack, so it is the conformance suite for this service.
It walks manufacturer → warehouse → retailer → consumer and then a batch
recall, asserting the numbered business rules rather than status codes. Run it
before and after any change to identity, custody, packaging, sale or recall.

Two more scripts sit beside it and work the same way.
`production-lifecycle-walkthrough.mjs` covers the manufacturing lifecycle: the
batch opening with its order, the QC verdict gating identity assignment, the
cumulative cap and the amendment. `commerce-fulfilment-walkthrough.mjs` covers
sales-order fulfilment to both kinds of customer — a registered buyer, through
to the buyer's receipt, and an off-platform one, through to the sale. Together
they are the end-to-end coverage this service has.

The per-address rate limits will stop it after a few runs. Set RATE_LIMIT_LOGIN,
RATE_LIMIT_REGISTER and RATE_LIMIT_VERIFY to 0 locally to switch them off.

```bash
pnpm walkthrough              # against localhost:8081
pnpm walkthrough:production   # manufacturing lifecycle and QC gates
pnpm walkthrough:commerce     # sales-order fulfilment, both destinations
```

Unit tests need no database and are safe to run in CI:

```bash
pnpm test
pnpm typecheck
```

## Layout

One directory per bounded concern, matching the proposal's section 13
application layer.

| Module | What it owns |
| --- | --- |
| `auth` | accounts, JWT, the twelve roles of section 12, capability guard |
| `organization` | participating businesses, trading-partner directory |
| `location` | physical places belonging to an organization |
| `product` | catalogue definitions (no quantity — see below) |
| `batch` | production lots, the unit of recall |
| `item` | QR identities, packaging hierarchy, lifecycle outcomes |
| `traceability` | the append-only event log, timelines, public verification |
| `inventory` | current stock, derived |
| `transfer` | dispatch, receipt, relocation |
| `sale` | business and final-consumer sales |
| `recall` | batch recall and impact mapping |
| `dashboard` | operational summary, derived from the event log |
| `licensing` | applications, review, renewal, suspension, certificates |
| `manufacturing` | raw materials, BOMs, machines, production orders, QC records |
| `logistics` | transporters, vehicles, drivers, routes, shipments, POD |
| `commerce` | customers, quotations, sales orders, invoices, payments, returns |
| `finance` | chart of accounts, cost centres, journals, budgets, reports |
| `payroll` | departments, positions, employees, attendance, leave, pay runs |
| `analytics` | the section 10 executive dashboards |
| `reporting` | section 22 report catalogue, JSON and CSV |
| `security` | audit log, response headers, rate limiting |
| `notifications` | per-user inbox and WebSocket push |
| `email` | SMTP delivery and templating |

## Decisions worth knowing

**Stock is derived, never stored.** There is no quantity column on `Product`
and no stock-movement ledger. Inventory is computed from the identities an
organization holds, so it cannot drift out of step with the event log
(business rule 4). The old Java service kept a parallel `Product.quantity` and
`StockMovement` table that the traceability engine never updated; that model is
deliberately not ported.

**Inventory counts leaves, not top-level items.** Counting from the top means
trusting a container's rolled-up quantity — which goes stale whenever anything
nested changes — and makes a mixed pallet with no product of its own vanish
from stock entirely. Counting leaf identities has neither problem, and a bulk
container that was never opened is itself a leaf, so it still counts in full.

**The lot exists from the moment the order does.** A production order opens its
batch at *creation*, not at completion, because every step of the run — start,
material issue, completion, inspection — needs a lot identity to attach an
event to, and a batch that appears only at the end leaves the whole run with
nowhere to record itself. The lot starts ACTIVE, completion moves it to
PENDING_QC, and only a QC verdict of APPROVED lets identities be minted against
it. A batch created directly from the catalogue has no run to inspect, so it
stays ACTIVE and may be registered against immediately.

The dates go on at completion, not at creation: nothing has been made when the
order is planned, so `manufacturedOn` is the completion date and `expiresOn` is
whatever the caller passes to `complete()`. Items copy `expiresOn` from their
batch when registered, so a lot that finishes undated produces stock the expiry
sweep can never reach.

**A customer is not a buyer.** `Customer.organization` is the *seller* — the
tenant whose customer list the record belongs to. The party being sold to is
`Customer.buyerOrganization`, and it is null for most of them: a shop with a
walk-in account, a hospital that never registered. That field decides what
fulfilling a sales order means. With a buying organization the goods stay in
the chain and travel by transfer, which the buyer confirms on receipt. Without
one there is nobody downstream to confirm anything, so a transfer would strand
the stock IN_TRANSIT for ever — the goods have left the chain, and that is a
sale (`SaleService.recordOffChainSale`). Exactly one of `transferId` and
`saleId` is set on a fulfilled order.

The link is never inferred from a matching name or email. Guessing which
organization a customer record refers to would hand custody of real stock to
whoever happened to match.

**Events are append-only.** `EventRecorder` is the only writer and it only ever
inserts. A mistake is corrected by appending a `CORRECTION` that points at what
it compensates (business rule 14).

**Everything is closed by default.** `JwtAuthGuard` is registered globally, so
a new endpoint is authenticated unless it explicitly declares `@Public()`. Only
registration, login and product verification are public.

**Reads are scoped to the chain of custody.** An organization sees an identity
if it holds it, if it has handled it, or if it is a regulator. That keeps
organizational data isolated (proposal section 25) without breaking a
manufacturer's ability to trace what it made (section 9). Items outside the
caller's chain report as not-found, because confirming existence would itself
leak that someone else holds stock under that code.

**Public verification takes the token only.** `/api/verify/:token` matches the
opaque QR payload and not the printed code. Printed codes are sequential, so
accepting them there would let anyone enumerate the whole catalogue one
increment at a time (proposal section 16).

## Licensing

Proposal §1. An organization applies for a licence, attaches certificates, a
regulator screens it, and an approved licence runs for a fixed term and must be
renewed. `LicenseCategory` decides who may apply, which documents are required
and which product categories the licence covers.

Two ways out of `ACTIVE`, and they are different tools. `EXPIRED` lapses on a
date and is fixed by renewing. `SUSPENDED` is a decision taken today — the
defect case — and is reversed by reinstating. Both still allow the holder to
**receive** goods: when product is bad you want it flowing back to the
manufacturer, and a state that blocked returns would strand it in shops. Only
`REVOKED` closes the door.

Renewal creates a *new* licence pointing back at the old one rather than
editing dates, so the record of who was authorised during which window
survives. `LicenseEvent` is append-only for the same reason `TraceabilityEvent`
is: if a regulator has to defend a suspension, that is the record that does it.

**Enforcement is advisory by default.** Searched end to end, the proposal never
asks for an unlicensed business to be blocked: §1 specifies "compliance status"
and "automated license expiry notifications", and §10 puts "license status" and
"expired licenses" on the regulator's dashboard. That is supervision, not
gatekeeping.

So a non-compliant operation goes through, records a `ComplianceFinding`
against the organization, and notifies the holder. The regulator reads the
findings at `GET /api/regulator/licenses/findings` and can suspend or revoke —
which is the lever the document actually describes. `LICENSING_ENFORCEMENT`
switches this to `strict` (refuse instead) or `off`.

Two things are never advisory. **Revoked licences are refused in every mode** —
revocation is terminal and stopping the business is the point. And safety
actions are never gated at all: returns and recalls stay available from a
business that has just been found to have a problem.

New organizations receive a provisional licence at registration, on the same
terms as the grandfathering in the licensing migration. Without it the
migration's cut-off date leaked into normal operation — everyone onboarded
before it traded on a provisional licence while everyone after it was
non-compliant from their first action.

### File storage

Certificates go through `StorageProvider`. Drivers:

- `local` (default) — files under `STORAGE_LOCAL_ROOT`
- `cloudinary` — set `STORAGE_DRIVER=cloudinary` plus `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (optional `CLOUDINARY_FOLDER`)

Nothing in licensing touches a concrete store. Local disk generates its own
stored filenames and never uses the uploaded one as a path. `signedUrl`
returns null for local disk, so bytes stream through the API; Cloudinary
returns a time-limited authenticated URL.

### Grandfathering

The licensing migration issues every organization already in the database a
**provisional** licence valid for 90 days. Without it, switching licensing on
would stop every existing business from operating the moment the migration ran.
It is a grace period, not an exemption: it lapses like any other licence, and
renewing means going through the real application.

## Not yet built

Two documents govern this service and they have different scopes. *Core
Architecture & MVP Scope* is the engineering contract — it defines the fourteen
business rules cited throughout this codebase, and its §20 guardrail asks of
every feature whether it improves identity, packaging, inventory, transfer,
traceability, verification, recall, privacy or offline sync. The *Technical
Proposal* is the full commercial vision. Measured against the MVP doc this
service is nearly complete; measured against the proposal it is well short.
Both readings are below, because using the wrong one makes the state of the
work look either better or worse than it is.

### Open against the MVP contract

Nothing outstanding. Offline sync and expiry monitoring, the two items that
were open, landed with `POST /api/sync` and the nightly `ExpiryService` sweep.

**Offline sync** (§10 module 12, §11, §17). A device posts its queue in the
order it recorded it and gets a verdict per operation. Order is preserved,
because a queue is a history and packing precedes dispatch. One bad operation
does not abort the batch - a day of scans should not be lost to the fourth
one being wrong. A replayed operation returns DUPLICATE rather than an error,
because a device told "already applied" has achieved what it wanted and should
mark it synchronised (business rule 12). There is deliberately no batch-wide
transaction: these are separate physical events that already happened, and
rolling back forty of them because the forty-first was invalid would rewrite
history to suit the upload.

**Expiry monitoring** (§0.1 capability 6). Prevention already existed - a sale
refuses out-of-date stock. Monitoring did not, so an item past its date kept
ACTIVE status and kept counting toward `availableUnits`: the dashboard was
telling the truth about the database and a lie about the warehouse. The
nightly sweep moves it to EXPIRED with an event, warns holders about stock due
within `NEAR_EXPIRY_DAYS`, and lapses licences whose dates have passed. Trigger
it directly with `POST /api/maintenance/expiry-sweep`.

### Closed since this section was written

- **Quality control now gates the lifecycle.** `BatchStatus` carries
  PENDING_QC / APPROVED / REJECTED / REWORK / QUARANTINED, and
  `permitsIdentityAssignment` decides whether a lot may be given identities at
  all. See *The batch lifecycle* below.
- **Commerce moves goods.** `SalesOrderService` reserves identities
  (`RESERVED`), fulfilment either dispatches them to a registered buyer or
  sells them out of the chain, and an approved return records `RETURNED`
  against the items. See *A customer is not a buyer* above.
- **Transfer discrepancies stay open.** A partial receipt lands the transfer in
  `PARTIALLY_RECEIVED` with the missing codes recorded, so the rest can arrive
  later instead of being stranded IN_TRANSIT.
- **Manufacturing history is on the product.** Production start, material
  issue, completion and the QC verdict are recorded against the lot, so a unit's
  timeline reads PRODUCTION_STARTED → MATERIAL_ISSUED → PRODUCTION_COMPLETED →
  QC_INSPECTED → BATCH_APPROVED → MANUFACTURED, batch-level entries marked
  `viaBatch`.
- **Licence enforcement is advisory**, as the Licensing section above
  describes, and new organizations receive a provisional licence at
  registration — so self-serve onboarding works.

### Still open against the technical proposal

- **Finance is a manual ledger.** Double-entry validation is correct, but no
  module outside `src/finance/` posts to it — no COGS, no AR from invoices, no
  inventory valuation, no payroll journal.
- **Raw materials have no stock.** No supplier, purchase order or goods
  receipt, and no on-hand quantity, so §8's receiving workflow cannot run and
  `reorderLevel` has nothing to compare against.
- Absent modules: warranty and after-sales, export and customs, assets,
  stock adjustment and cycle counting, product variants, stock valuation.
- MFA, encryption at rest, backups (§15). Rate limiting now covers the
  unauthenticated routes; see below.
- Barcode formats — Code128 / EAN / UPC (§14). QR only today.

### Rate limiting

`FixedWindowLimiter` is applied through `RateLimitGuard`, registered globally
and inert unless a route declares `@RateLimit`. It covers login, registration
and public verification — the routes that answer without a token.

State is per-process. Behind more than one replica each enforces its own share
and the effective limit multiplies by the replica count, so this moves to Redis
before horizontal scaling. The guard reads `request.ip`, which Express only
derives from `X-Forwarded-For` when `TRUST_PROXY_HOPS` matches the number of
proxies actually in front of the service.

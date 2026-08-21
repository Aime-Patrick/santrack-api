# DR-07 — Authorization and Production Eligibility

Status: proposed, not implemented. Read-only audit; no code, schema, migration or
frontend was changed in producing it.

Scope: whether SanTrack can answer *"is this manufacturer legally and operationally
allowed to produce this specific product at this specific facility right now, and if
not, exactly why not"*, and what the minimum architecture is that makes that a
first-class workflow.

---

## 1. Current architecture

### 1.1 What the licensing module actually contains

Six tables, verified against both the entity source and the live database
(`docker exec santrack-postgres psql -U stock -d santrack`):

| Table | Source | Grain |
| --- | --- | --- |
| `license_categories` | `src/licensing/entities/license.entity.ts:27` | the *rule*: what a kind of licence authorises |
| `licenses` | `src/licensing/entities/license.entity.ts:93` | the *instance*: one organization's authorisation for one activity |
| `license_documents` | `src/licensing/entities/license.entity.ts:167` | certificates attached to an application |
| `license_events` | `src/licensing/entities/license.entity.ts:208` | append-only audit of decisions on a licence |
| `compliance_findings` | `src/licensing/entities/compliance-finding.entity.ts:32` | append-only record that an organization acted outside its licence |
| (enum) `LicenseStatus` | `src/licensing/licensing.enums.ts:6` | DRAFT, SUBMITTED, UNDER_REVIEW, REJECTED, ACTIVE, EXPIRED, SUSPENDED, REVOKED |

`LicensedActivity` (`licensing.enums.ts:58`) has five members: MANUFACTURING,
WAREHOUSING, DISTRIBUTION, RETAIL, REGULATION. There is exactly one activity per
organization type, resolved by `requiredActivityFor()`
(`license-enforcement.service.ts:174`) and again, independently, by `activityForType()`
(`license.service.ts:776`). The two functions are duplicates of each other and the
second carries a comment saying so.

### 1.2 The application and review workflow that exists

Applicant side, all in `LicenseService`:

- `apply()` (`license.service.ts:74`) — opens a DRAFT, refuses if the category does not
  apply to the organization's type, refuses if a non-provisional licence for the same
  category is already DRAFT/SUBMITTED/UNDER_REVIEW/ACTIVE.
- `attachDocument()` (`:145`) — PDF/JPEG/PNG/WebP only, 10 MB cap, DRAFT only.
- `submit()` (`:205`) — refuses unless every `category.requiredDocuments` entry is present.
- `renew()` (`:426`) — creates a *new* licence row pointing back at the old one through
  `previousLicense`. Nothing is overwritten, so the record of who was authorised during
  which window survives.

Regulator side:

- `queue()` (`:241`), `startReview()` (`:257`), `decide()` (`:284`), `suspend()` (`:339`),
  `reinstate()` (`:366`), `revoke()` (`:395`). Every one calls `requireRegulator()`
  (`:740`), which checks only that the acting organization's type is REGULATOR.
- `DecisionDto.decision` is `APPROVE | REJECT` (`dto/license.dto.ts:26`). There is no
  "request changes" and no "withdraw".
- Approval sets `issuedOn = today()` and `expiresOn = dto.expiresOn ?? addMonths(issuedOn,
  category.validityMonths)` (`:319-324`).

Expiry: `expireLapsed()` (`:508`) flips lapsed ACTIVE rows to EXPIRED, run nightly at 02:00
by `ExpiryService.lapseLicences()` (`src/maintenance/services/expiry.service.ts:195`).
Read paths do not wait for it — `judge()` (`license-enforcement.service.ts:327`) evaluates
`isWithinDates(today())` on every read.

### 1.3 The enforcement model

`LicenseEnforcementService.check()` (`license-enforcement.service.ts:88`) runs in one of
three modes from `licensing.enforcement` config: OFF, ADVISORY (the default), STRICT.
Under ADVISORY the operation proceeds, a `ComplianceFinding` is written and the holder's
ORG_ADMIN/MANAGEMENT users are notified. REVOKED is refused in every mode. The reasoning
is documented at length in the service header and traced to the technical proposal:
the proposal asks for supervision, not gatekeeping.

`assess()` (`:133`) picks the best licence for an activity by rank
(LICENSED 4 > REVOKED 3 > SUSPENDED 2 > EXPIRED 1 > NONE 0).

### 1.4 Every production gate that exists today

Grepping the whole tree for consumers of the enforcement service returns exactly two
call sites, both in `ProductionService`:

- `start()` — `production.service.ts:212`, `checkOwnTrade(organization, 'start production')`
- `complete()` — `production.service.ts:391`, `checkOwnTrade(organization, 'complete production')`

Nothing else consults licensing. In particular:

- **`ProductionService.create()` (`production.service.ts:87`) has no licensing check at all.**
  A production order and its batch can be created by any organization holding
  `RUN_PRODUCTION`, in any state of licensure.
- `ProductService.create()` has none. `TransferService`, `SaleService`, `ItemService`
  and `RecallService` have none.
- `LicenseService` is injected in only two other places: `ExpiryService` (for the nightly
  sweep) and `OrganizationService` (to issue the provisional licence at registration).

### 1.5 Facility

`Facility` (`src/organization/entities/facility.entity.ts:29`) carries
`organizationId`, `name`, `code`, `address`, `active`. `facility_id` was added by
migration `1757500000000-Facility.ts` to exactly four tables — `locations`, `machines`,
`production_orders`, `batches` — and backfilled again by `1757700000000`.

`FacilityController` (`src/organization/controllers/facility.controller.ts`) exposes a
single `GET /api/facilities` that lists the caller's own sites. Its header comment says
"Read-only for now". **There is no endpoint to create, rename, deactivate or split a
facility.** One facility is auto-created per organization at registration
(`organization.service.ts:100-112`, named `"<org> — main site"`).

Live data: 211 facilities across 211 organizations; the query
`SELECT organization_id FROM facilities GROUP BY 1 HAVING count(*) > 1` returns zero rows.
No organization on the platform has a second site, and none can be given one through the API.

### 1.6 Product

`Product` (`src/product/entities/product.entity.ts:27`) carries `organizationId`, `sku`,
`categoryId` → `ProductCategory`, `traceabilityLevel`, `gtin`, `barcodeSymbology`.
There is no authorization, registration, approval or regulator relation of any kind.
Live: 111 products, 19 of which have a `category_id`. `product_categories` holds two rows,
DAIRY and BOOKS.

### 1.7 Two dead fields, and what that means

The auditor's method requires distinguishing what exists from what is *read*.

**`LicenseCategory.permittedProductCategories`** (`license.entity.ts:63`) is dead. Grepping
every reader in the tree returns one hit outside the entity and the migration:
`license.controller.ts:56`, which copies it into a JSON response for display. No decision
anywhere reads it. Live data confirms it has never been used in anger: every active
category has `permitted_product_categories = '{}'`; the only non-empty value, `{DAIRY}`,
sits on `MFG-001`, the duplicate category deactivated by migration `1757300000000`.

**`License.provisional`** (`license.entity.ts:147`) is dead *as a decision input*. It is
written by `issueProvisional()` (`:681`) and by the grandfathering migration; it is read
in exactly two places: the `apply()` duplicate check excludes provisional rows (`:110`),
and `describe()` returns it to the browser (`license.controller.ts:293`). **No enforcement
path reads it.** `assess()` and `judge()` treat a provisional ACTIVE licence as
indistinguishable from a regulator-approved one.

That matters more than it sounds, because of the live distribution:

```
 status  | provisional | count
---------+-------------+-------
 DRAFT   | f           |     1
 ACTIVE  | t           |   179
 ACTIVE  | f           |     1
 REVOKED | t           |     1
```

180 of 182 licences on the platform are provisional. Exactly one organization holds a
regulator-approved licence. The entire platform currently operates on onboarding grace,
and every enforcement decision the system has ever made has treated that grace as full
authorisation.

### 1.8 There is no jurisdiction model

`queue()` (`license.service.ts:241`) returns every SUBMITTED or UNDER_REVIEW licence on the
platform to any caller whose organization type is REGULATOR. `decide()`, `suspend()` and
`revoke()` gate on the same single predicate. Five REGULATOR organizations exist. Any one
of them can screen, approve, suspend or revoke any application belonging to any business,
and can read every applicant's uploaded certificates through
`GET /api/regulator/licenses/:id/documents`. Nothing in the schema expresses which
authority is responsible for which category, activity or territory.

---

## 2. Missing capabilities

The fifteen questions in the brief, answered against the code as it stands.

| # | Question | Answerable today? | Where it fails |
| --- | --- | --- | --- |
| 1 | Is this organization authorized to manufacture? | Yes | `assess(orgId, MANUFACTURING)` |
| 2 | Is this *facility* authorized to manufacture? | **No** | `licenses` has no facility column; verified in the entity, the migration and `\d licenses` |
| 3 | Is the org/facility authorized for this product category? | **No** | the only field that could express it, `permittedProductCategories`, is never read |
| 4 | Is this specific product authorized/registered? | **No** | no entity, no column, no concept |
| 5 | Is the authorization currently valid? | Yes | `isWithinDates()` + `judge()` |
| 6 | Expired? | Yes | `LicenseStatus.EXPIRED`, `expireLapsed()` |
| 7 | Suspended/revoked? | Yes | `suspend()`, `revoke()`, ranked in `assess()` |
| 8 | May this manufacturer produce this product at this facility? | **No** | no composite evaluation exists anywhere |
| 9 | Can SanTrack explain exactly why production is blocked? | **No** | `refusal()` produces one sentence about one licence; there is no per-check breakdown |
| 10 | Can the manufacturer submit an application? | Yes, for a licence | `apply()` → `attachDocument()` → `submit()` |
| 11 | Can the regulator review it? | Yes, but unscoped | `queue()`, `startReview()` — any regulator, any application |
| 12 | Approve / reject / request changes? | Approve and reject only | `ReviewDecision` has two members |
| 13 | Is the historical regulatory decision preserved? | Partly | `LicenseEvent` preserves status transitions; it does not preserve the licence's *dates* at the time, nor the deciding *organization* |
| 14 | Can a regulator see what falls under its jurisdiction? | **No** | there is no jurisdiction; every regulator sees everything |
| 15 | Can a manufacturer see its authorization status before producing? | Partly | `GET /api/licenses` lists its own licences; nothing relates them to a product or a site |

Six hard NOs. The three structural ones are: **no facility grain of authorization**,
**no product grain of authorization**, and **no composite evaluation**. Everything else in
the brief follows from those three.

Two further gaps that are not in the brief but block it:

- **Facilities cannot be created.** The Inyange scenario — one organization, two plants —
  is not merely unauthorised today, it is unrepresentable: there is no write endpoint and
  no organization has a second site.
- **`ProductionService.create()` is ungated.** Whatever eligibility rule is agreed, the
  place it has to attach does not currently consult licensing at all.

---

## 3. Domain concepts

The brief asks for six concepts to be explicitly distinguished, and for a plain statement
of which exist.

**(A) Organization/facility operating authorization** — "this business may carry on this
activity". Exists at the organization grain only, as `License`. Does not exist at the
facility grain.

**(B) Product authorization / registration** — "this specific product may be placed on the
market / manufactured". Does not exist. No entity, no column, no enum value, no endpoint.

**(C) Production authorization / request** — "this specific run may go ahead". Does not
exist. `ProductionOrder` is a *plan*, not a permission: it is created without any
authorization check and its status enum (PLANNED, IN_PROGRESS, COMPLETED, CANCELLED,
CLOSED) contains no regulatory state.

**(D) Regulatory requirement** — "the rule that says an authorization is needed at all".
Does not exist, and is deferred by explicit instruction. Today the *only* thing playing
this role is `LicenseCategory`, which conflates the rule with the product it produces.

**(E) LicenseCategory** — exists. The rule for one kind of licence: which activity, which
organization types may hold it, which documents it demands, how long it runs. This is the
closest thing SanTrack has to a requirement, but it is platform-owned seed data with no
issuing authority attached, and its category-scoping field is dead.

**(F) License** — exists. One organization's instance of (E), with dates, status, an
append-only event log, renewal chaining, and a `provisional` flag.

The critical observation for section 4: **(A), (B) and (C) are three different grains of
the same idea** — a regulator-issued permission with a lifecycle: applied for, screened,
issued with dates, suspended, reinstated, renewed, revoked. SanTrack already implements
that lifecycle exactly once, in `License`. (D) is a genuinely different idea — it is the
rule that decides whether any of the three are required at all.

---

## 4. Recommended model

Four changes, in dependency order. Only the first two are MVP.

### 4.1 Widen the grain of `License` from organization to (organization, facility?)

```
licenses
  + facility_id  int NULL  REFERENCES facilities(id)
  + INDEX idx_license_facility (facility_id)
```

`NULL` means "the organization as a whole"; a value means "this site only". Every existing
row stays NULL, which is factually correct — no licence on the platform was ever issued
against a site.

This is the smallest change that makes "Kigali is authorized, Huye is pending" expressible,
and it makes it expressible *with the machinery that already exists*: a facility licence is
applied for through `apply()`, gets its certificates through `attachDocument()`, is screened
through `startReview()`/`decide()`, lapses through `expireLapsed()`, is halted through
`suspend()` and renewed through `renew()`. No second state machine, no second audit trail,
no second expiry sweep, no second review queue.

It is not free. Five queries currently assume a licence belongs only to an organization and
would silently give wrong answers the day the column exists. They are enumerated in
section 15.

### 4.2 A `ProductionEligibilityService`, and no `ProductionApplication`

One service, one method, one shape:

```ts
evaluate(request: {
  organizationId: number;
  facilityId: number | null;
  productId: number;
  requestedQuantity: number;
  requestedDate: string;          // yyyy-MM-dd
}): Promise<EligibilityResult>

interface EligibilityResult {
  eligible: boolean;              // the regulatory verdict
  blocking: boolean;              // whether creation is actually refused — see 4.2.1
  evaluatedAt: Date;
  checks: EligibilityCheck[];     // ordered, one per rule, always the full list
}

interface EligibilityCheck {
  code: EligibilityCheckCode;
  status: 'PASS' | 'FAIL' | 'WARN' | 'NOT_APPLICABLE';
  message: string;                // what a manufacturer reads
  remedy?: { label: string; href: string };   // what they do next
}
```

This shape is not invented. It is the shape SanTrack already uses for exactly this problem
one layer down: `AvailableAction { action, available, reason? }`
(`src/traceability/available-actions.ts:42`), whose header comment says why —
*"An operator who is told 'this pallet is in transit, the receiving party confirms it'
learns the system. One shown a button that fails on click learns to distrust it, and one
shown no button at all learns nothing."* Eligibility is the same argument at the
regulatory grain.

Check codes, evaluated in this order, all of them always returned:

| Code | Asks | Source of truth |
| --- | --- | --- |
| `ORGANIZATION_LICENCE` | is the org licensed for MANUFACTURING? | `assess(orgId, MANUFACTURING)` |
| `FACILITY_AUTHORIZATION` | is this site authorized? | facility-scoped licence, falling back to the org-wide one (§4.1) |
| `PRODUCT_CATEGORY_COVERAGE` | does the governing licence cover this product's category? | `LicenseCategory.permittedProductCategories` — wired up at last |
| `PRODUCT_AUTHORIZATION` | is this product authorized where required? | §4.3; `NOT_APPLICABLE` until then |
| `LICENCE_VALIDITY_AT_REQUESTED_DATE` | is the licence still valid on the requested production date? | `isWithinDates(requestedDate)` — note the date, not `today()` |
| `PRODUCT_TRACEABILITY` | can the product's traceability level be satisfied at this site? | `Product.traceabilityLevel` (DR-01) |
| `BATCH_AND_RECALL_RESTRICTIONS` | is this product under an open recall or a suspended batch? | `RecallService`, `BatchStatus` |
| `PER_PRODUCTION_APPROVAL` | does an applicable requirement demand a per-run approval? | §6; `NOT_APPLICABLE` until requirements exist |

`LICENCE_VALIDITY_AT_REQUESTED_DATE` is the check that produces the brief's example
*"Manufacturing licence expires before requested production date"*, and it is the reason
`requestedDate` is a parameter rather than an afterthought. `isWithinDates()` already takes
a date argument (`license.entity.ts:156`); nothing today ever passes it anything but
`today()`.

#### 4.2.1 `eligible` and `blocking` are two different answers, and conflating them would be a silent policy change

`EnforcementMode` defaults to ADVISORY, and the service header
(`license-enforcement.service.ts:29-52`) documents at length why: the technical proposal
asks for supervision, not gatekeeping, and searched end to end it never asks for an
unlicensed business to be stopped mid-operation.

An eligibility service that refuses to create a `ProductionOrder` whenever `eligible ===
false` would convert the entire platform to STRICT by the back door — and with 180 of 182
licences provisional, it would be a very loud conversion. So:

- `eligible` is the regulatory verdict and is computed identically in all three modes.
- `blocking` is `eligible === false && mode === STRICT`, plus the one unconditional case:
  a REVOKED licence blocks in every mode, matching `check()`'s existing carve-out
  (`license-enforcement.service.ts:104`).
- Under ADVISORY, a `FAIL` creates the order, writes a `ComplianceFinding`, notifies the
  holder, and shows the manufacturer the failing check. That is exactly today's behaviour,
  with the addition that the manufacturer is now told *which* check failed and *what to do*.

### 4.3 `ProductAuthorization`, as a third grain of `License` — post-MVP

Recommended concretely: not a new table, but a further widening of the same one.

```
licenses
  + product_id   int NULL  REFERENCES products(id)
```

with a new `LicenseCategory` row per authority whose `activity` names the trade it belongs
to. `apply()`, `submit()`, `decide()`, `suspend()`, `revoke()`, `renew()`, `expireLapsed()`
and `LicenseEvent` then work on product authorizations for free.

The name is decided in section 5.4 and the alternative of a standalone entity is compared
there. This is post-MVP because the *rule* that decides whether a given product needs an
authorization at all is `RegulatoryRequirement`, which is deferred; without it, adding
product authorizations only lets a manufacturer volunteer for a check nobody has imposed.

### 4.4 An append-only `production_eligibility_decisions` table

```
production_eligibility_decisions
  id                bigserial PK
  organization_id   int NOT NULL
  facility_id       int NULL
  product_id        int NOT NULL
  requested_quantity int NOT NULL
  requested_date    date NOT NULL
  eligible          boolean NOT NULL
  blocking          boolean NOT NULL
  enforcement_mode  varchar NOT NULL          -- the mode in force at the time
  checks            jsonb NOT NULL            -- the full ordered check list, verbatim
  relied_on         jsonb NOT NULL            -- {licenseIds:[], licenseNumbers:[], categoryCodes:[]}
  ruleset_version   varchar NOT NULL          -- see §16
  evaluated_at      timestamptz NOT NULL DEFAULT now()
  evaluated_by_id   int NULL REFERENCES users(id)

production_orders
  + eligibility_decision_id  bigint NULL REFERENCES production_eligibility_decisions(id)
```

Never updated after insert, for the same reason `TraceabilityEvent` and `LicenseEvent` are
never updated: it is the record a regulator may have to rely on in three years. Section 16
explains why a stored snapshot, rather than re-evaluation, is the only correct answer to
the 2026-batch-audited-in-2028 problem.

---

## 5. Alternatives considered

### 5.1 Facility-level authorization

| | Current schema | Proposed schema | Rationale | Migration impact | MVP impact | Future impact |
| --- | --- | --- | --- | --- | --- | --- |
| **A1. `licenses.facility_id` nullable** *(recommended)* | `licenses(organization_id, category_id, …)`; no facility column | `+ facility_id int NULL FK facilities(id)`, `+ index` | A facility authorization *is* a licence in every operational respect — applied for, screened, dated, suspended, renewed. One state machine, one audit trail, one queue, one expiry sweep. | Additive, non-destructive; all existing rows NULL, which is true. But five existing queries change meaning and must gain a facility predicate (§15) | Small. One column, one migration, five query changes, plus the `apply()` uniqueness rule becoming per-(category, facility) | Good. Suspending Huye leaves Kigali alone with no new code |
| **A2. Separate `FacilityAuthorization` entity** | as above | new table with its own status enum, events, documents, review endpoints | Isolates the change; existing licence queries untouched | Additive but large: 3–4 new tables | Large. A second review queue for regulators, a second application flow for manufacturers, a second expiry sweep | Bad. Two state machines expressing one idea. The auditor method treats a duplicate state machine as a finding, not a design. Its one advantage — leaving licence queries alone — is illusory, because eligibility must read both anyway |
| **A3. `license_scopes(license_id, facility_id, product_category_id)`** | as above | licences stay org-grained; a child table lists what each covers | Models scope as data rather than columns; naturally many-to-many | Additive, one table | Medium | Poor for the case that matters. Suspending Huye means suspending a *scope row*, which has no status, no reason and no event log. Adding those makes it A2 with extra steps |
| **A4. Do nothing; express it in rules over existing data** | as above | none | Zero migration | None | Cannot answer question 2 at all. There is no per-facility fact in the database to read | Dead end |

**A1 wins** because facility authorization has a lifecycle, and SanTrack has exactly one
correct implementation of that lifecycle. A2 and A3 both end up rebuilding it.

### 5.2 Production eligibility

| | Current | Proposed | Rationale | Migration | MVP | Future |
| --- | --- | --- | --- | --- | --- | --- |
| **B1. `ProductionEligibilityService`, computed** *(recommended)* | two ad-hoc `checkOwnTrade` calls in `ProductionService` | one service, full ordered check list, called from a preview endpoint and from `create()` | Mirrors `available-actions.ts`, the pattern the codebase already trusts for "what can be done right now, and why not". No new state to fall out of step with reality | One table (§4.4) for the *record*, none for the *evaluation* | Moderate: one service, one endpoint, one gate in `create()` | Extends by adding check codes, not tables |
| **B2. `ProductionRequest` entity, always created** | none | manufacturer submits a request; system evaluates; order created from an approved request | Gives a durable object to attach documents and correspondence to | New table + status enum | Large; adds a step to every single production run | Bad by default: forces a request/approval ceremony on runs no regulation requires. See section 6 |
| **B3. Inline checks in `ProductionController`** | closest to today | add licence reads to the controller | No new abstraction | None | Small | Bad. Guarantees the scatter the brief asks to avoid: the same rule re-implemented in the order controller, the batch controller, the item controller and the dashboard, drifting apart |

**B1 wins.** B3 loses on maintainability; B2 loses on regulatory accuracy and is kept, in
narrowed form, as the post-MVP `ProductionApplication` of section 6.

### 5.3 Historical compliance

| | Current | Proposed | Rationale | Migration | MVP | Future |
| --- | --- | --- | --- | --- | --- | --- |
| **C1. Snapshot the decision** *(recommended)* | nothing recorded | append-only `production_eligibility_decisions`, `ProductionOrder` points at one | The 2026 run was permitted by the 2026 rules and the 2026 licences. Storing the verdict is the only way to reproduce it after either changes | One table, one nullable FK | Small | Grows with the check list at no cost |
| **C2. Re-evaluate historically from event logs** | — | reconstruct licence state at a past date from `LicenseEvent` | No new table; the event log genuinely does support "what status was this licence on 2026-03-04" | None | Small | Fails on rules. `LicenseCategory` is mutable seed data with no version — `permittedProductCategories`, `requiredDocuments` and `validityMonths` can all change with no record. And `LicenseEvent` records status transitions but never `issued_on`/`expires_on`, so a date-based verdict is not reconstructable |
| **C3. Version every rule entity and re-evaluate** | — | full bitemporal `RegulatoryRequirement` versioning | Most rigorous | Large | Out of scope; `RequirementEvent` and requirement versioning are deferred | Right long-term answer; C1 is forward-compatible with it via `ruleset_version` |

**C1 wins for MVP**, and does not preclude C3.

### 5.4 `ProductAuthorization` vs `ProductRegistration` vs something else

| Name | For | Against |
| --- | --- | --- |
| **`ProductAuthorization`** *(recommended)* | Consistent with `License`/authorization vocabulary already used throughout the licensing module; describes the *permission*, which is what eligibility reads | Slightly further from the language some authorities use |
| `ProductRegistration` | Probably closer to how food and drug authorities speak, and to how a manufacturer would describe the paperwork | **Collides head-on with existing SanTrack vocabulary.** "Registration" already means minting traceable identities: `Capability.REGISTER_IDENTITY`, `registeredUnits()` (`item.service.ts`), `ProductionService`'s "finished-goods registration", the `/dashboard/manufacturing/register-units` and `/register-package` screens. A field named `product.registered` would be read by half the team as "units have been registered against it" |
| `ProductLicence` | Reuses the existing noun exactly | Misleading: a licence in this system is held by an organization for an activity; a product does not carry on an activity |
| `MarketAuthorization` | Precise for placing-on-market | Narrower than needed — the question here is whether it may be *manufactured*, which is not always the same permission |

Recommendation: the concept is **product authorization**. Where a jurisdiction calls the
instrument a *registration*, that is the `LicenseCategory.name` (e.g. code `PRD-REG`, name
"Product Registration"), not a second entity. The word appears in the UI; the schema keeps
one unambiguous noun.

*Assumption to verify, not a fact: that any given authority requires product-level
registration for dairy or any other category. Nothing in this codebase establishes that,
and no jurisdiction should be hard-coded.*

---

## 6. Why the recommended model wins

**It answers three questions with three grains of one entity rather than three entities.**
"Can this business operate?", "can this site produce this category?" and "is this product
authorized?" differ only in what the permission is *about*. They are identical in
lifecycle: applied for, documented, screened by a named reviewer at a named authority,
issued with dates, suspendable, reinstatable, renewable, revocable, and audited
append-only. SanTrack implements that lifecycle once, correctly, with an append-only event
log and non-destructive renewal chaining. Building a second copy of it for facilities and a
third for products would be a duplicate state machine, which the project already treats as
a defect rather than a design.

**It keeps eligibility computed, not stored.** Authorization is durable state and belongs in
tables. Eligibility is a question about a moment, and the moment moves — a licence lapses at
midnight, a batch is recalled at noon. Storing an eligibility *status* would create exactly
the kind of drift that `ComplianceFinding`'s header comment already warns against when it
explains why there is deliberately no `resolved` flag. What gets stored is the *decision that
was made*, once, as a historical fact — never a live status to keep in sync.

**It respects the enforcement model instead of quietly replacing it.** Splitting `eligible`
from `blocking` means the recommendation adds an explanation without adding a gate. Under
ADVISORY — the default, and the mode the technical proposal is read to require — an
ineligible run still proceeds, still records a finding, and now additionally *tells the
manufacturer which check failed and what to do about it.* Nothing that works today stops
working.

**It resurrects a field the schema already has instead of adding one.**
`permittedProductCategories` was designed for precisely the "Huye is not authorized for
DAIRY" question and has never been read. `PRODUCT_CATEGORY_COVERAGE` gives it its job.

**It puts every check in one place with one shape.** The brief's requirement that SanTrack
explain *exactly* why production is blocked is not satisfiable by scattered `if` statements
returning prose; it needs a stable, ordered, machine-readable list of named checks that the
UI can render and the audit table can store verbatim. One service producing one array is
the whole answer to section 11.

**It does not create a deferred entity.** `RegulatoryAuthority`, `RegulatoryRequirement`
and `RequirementEvent` are designed here (sections 7, 10, 22) and built nowhere.

---

## 7. Entity relationships

Existing, unchanged:

```
Organization ─1:N─ Facility
Organization ─1:N─ Product ─N:1─ ProductCategory ─0:1─ ProductCategory (parent)
Organization ─1:N─ License ─N:1─ LicenseCategory
License ─1:N─ LicenseDocument
License ─1:N─ LicenseEvent                       (append-only)
Organization ─1:N─ ComplianceFinding ─0:1─ License
Organization ─1:N─ ProductionOrder ─0:1─ Facility
ProductionOrder ─0:1─ Batch ─0:1─ Facility
Batch ─1:N─ TraceableItem ─1:N─ TraceabilityEvent  (append-only, protected core)
```

Proposed, MVP:

```
License ─0:1─ Facility                            (NEW: licenses.facility_id, nullable)
ProductionOrder ─0:1─ ProductionEligibilityDecision (NEW)
ProductionEligibilityDecision ─N:1─ Organization
ProductionEligibilityDecision ─0:1─ Facility
ProductionEligibilityDecision ─N:1─ Product
```

Proposed, post-MVP:

```
License ─0:1─ Product                             (licenses.product_id, nullable)
ComplianceFinding ─0:1─ Facility
ComplianceFinding ─0:1─ ProductionOrder
```

Designed, deferred, not to be built:

```
RegulatoryAuthority ─1:1─ Organization            (where type = REGULATOR)
RegulatoryAuthority ─1:N─ RegulatoryRequirement
RegulatoryRequirement ─1:N─ RequirementEvent      (append-only)
RegulatoryRequirement ─N:M─ ProductCategory       (via requirement_scopes)
RegulatoryRequirement ─N:M─ LicensedActivity      (via requirement_scopes)
LicenseCategory ─0:1─ RegulatoryAuthority         (who issues this kind of licence)
ProductionApplication ─N:1─ RegulatoryRequirement (only where per-production approval is required)
ProductionOrder ─0:1─ ProductionApplication
```

Note the shape of the deferred part: a `ProductCategory` reaches an authority only *through*
a requirement. There is no `ProductCategory.regulatorId` and no direct category→authority
edge, exactly as DR-05 requires. Two authorities may attach different requirements to DAIRY
without the taxonomy taking sides.

The grain rule for `licenses`, stated once so it is testable:

| `organization_id` | `facility_id` | `product_id` | Means |
| --- | --- | --- | --- |
| set | NULL | NULL | the organization may carry on this activity anywhere |
| set | set | NULL | this site may carry on this activity |
| set | NULL | set | this product is authorized, wherever the organization makes it |
| set | set | set | this product is authorized at this site |

---

## 8. State machines

### 8.1 `LicenseStatus` — existing, extended by two values (post-MVP)

```
                    ┌──────────────── (regulator asks for more) ──────────┐
                    ▼                                                     │
DRAFT ──submit──> SUBMITTED ──startReview──> UNDER_REVIEW ──────────► CHANGES_REQUESTED
  ▲                   │                          │  │                     │
  │                   └────── decide ────────────┘  │                     │
  │                                │                │                  resubmit
  │                        ┌───────┴────────┐       │                     │
  │                     APPROVE           REJECT    │                     ▼
  │                        │                │       └──────────────► SUBMITTED
  │                        ▼                ▼
  │                     ACTIVE ─────────► REJECTED (terminal for this row; reapply)
  │                     │  │  │
  │        suspend ─────┘  │  └───── expireLapsed / date passes ──► EXPIRED
  │                        │                                          │
  │                        ▼                                          │
  │                    SUSPENDED ──reinstate──► ACTIVE or EXPIRED     │
  │                        │                                          │
  │                        └──────── revoke ──► REVOKED (terminal)    │
  │                                                                   │
  └───────────────────── renew (new row, previousLicense) ────────────┘

WITHDRAWN ◄── applicant abandons, from DRAFT or SUBMITTED (terminal)
```

`CHANGES_REQUESTED` and `WITHDRAWN` are **additions to the existing enum**, not a new
enum. Section 9 of the brief proposes an eight-state application machine — Draft,
Submitted, Under Review, Changes Requested, Approved, Rejected, Withdrawn, Expired.
Six of those eight already exist in `LicenseStatus`, with Approved expressed as ACTIVE
(the licence *is* the approval; there is no gap between being approved and being valid).
Creating a parallel `ApplicationStatus` would be a duplicate state machine over the same
rows. `ALTER TYPE … ADD VALUE` is additive and non-destructive.

`ReviewDecision` gains `REQUEST_CHANGES` alongside APPROVE and REJECT, with the same
mandatory-reason rule that REJECT already enforces (`license.service.ts:305`).

### 8.2 `ProductionOrderStatus` — unchanged

PLANNED → IN_PROGRESS → COMPLETED → CLOSED, with CANCELLED reachable from PLANNED and
IN_PROGRESS. **No regulatory state is added to this enum.** Eligibility is not a phase of a
production order; it is a precondition evaluated before one exists and recorded beside it.
Adding `AWAITING_AUTHORIZATION` here would put a regulatory concern inside an operational
machine and would force every run through it.

### 8.3 Eligibility — deliberately has no state machine

`EligibilityResult` is a value, not an entity. It is computed on request, rendered, and —
when a production order is created from it — frozen into one immutable row. It never
transitions. This is the same discipline `available-actions.ts` follows and the same
reasoning `ComplianceFinding`'s header gives for having no `resolved` flag.

### 8.4 `ProductionApplication` — future, only where a requirement demands it

```
DRAFT → SUBMITTED → UNDER_REVIEW → { APPROVED | REJECTED | CHANGES_REQUESTED }
APPROVED → CONSUMED (one production order created) | LAPSED (window passed unused)
```

Same vocabulary as `LicenseStatus` on purpose. Section 6 explains why this exists only
where regulation actually requires it.

---

## 9. Authorization boundaries

Two distinct meanings of "authorization" meet here and must not be blurred.

**Platform authorization — who may press the button.** Capability-based, unchanged:
`Capability` enum, `ROLE_CAPABILITIES`, `capabilitiesFor(role, organizationType)`,
`userCan()`, `@RequireCapability` under the global `JwtAuthGuard`. This DR proposes no new
authorization entity. Capabilities needed:

| Operation | Capability | New? |
| --- | --- | --- |
| Preview eligibility | `RUN_PRODUCTION` | no |
| Create a production order | `RUN_PRODUCTION` | no |
| Apply for any licence, at any grain | `MANAGE_CATALOG` | no — matches `license.controller.ts:69` |
| Read own compliance overview | `VIEW_OPERATIONS` | no |
| Create / rename / deactivate a facility | `MANAGE_CATALOG` | no |
| Screen and decide applications | `MANAGE_RECALL` + REGULATOR standing | no — matches the existing review controller |
| Read the cross-business register | `OVERSEE_INDUSTRIES` | no |
| Own the canonical taxonomy and authorities | `ADMINISTER_PLATFORM` | no |

The one thing worth flagging: the regulator review routes today are gated on
`Capability.MANAGE_RECALL` (`license.controller.ts:215, 226, 239, 251, 265`). That reads
oddly — approving a licence is not issuing a recall — but it is not wrong in effect, since
`requireRegulator()` re-checks standing in the service. A dedicated `DECIDE_APPLICATIONS`
capability would be clearer; it is listed as an open question rather than proposed, because
re-scoping a capability changes who can do what and deserves its own approval.

**Regulatory authorization — who may lawfully manufacture.** This is the subject of the
whole DR and it lives in data, not in guards. The boundary rule:

> A capability check decides whether the request is *allowed to be made*. An eligibility
> check decides whether the activity is *lawful*. Neither substitutes for the other, and a
> user who holds `RUN_PRODUCTION` at an unauthorized facility must be refused by the second,
> never by the first — because the refusal has to carry a regulatory reason a manufacturer
> can act on, not a 403.

**Ownership boundaries that must hold** (falsifiable forms in section 24): a licence's
facility must belong to that licence's organization; a licence's product must belong to
that licence's organization; a production order's facility must belong to its organization
(already enforced at `production.service.ts:736`); eligibility is evaluated only for the
caller's own organization unless the caller holds `OVERSEE_INDUSTRIES`.

---

## 10. Manufacturer workflow

The workflow the brief describes, mapped onto the model.

**Before production — establishing authorization.**

1. Register the organization. A provisional licence is issued automatically
   (`organization.service.ts:127`), and one facility is created. *Unchanged.*
2. Create the second facility. **New capability required — no write endpoint exists today.**
   Inyange adds "Huye Dairy Plant" alongside "Kigali Dairy Plant".
3. Apply for a full manufacturing licence: `POST /api/licenses` with `categoryId`, and —
   new — an optional `facilityId`. Omitting it means the application covers the whole
   organization; supplying it means this site only.
4. Attach the certificates the category demands, submit, wait for a regulator.
5. Once product authorizations exist (post-MVP), apply per product where a requirement says
   one is needed.

**Producing.**

6. Open Start Production. Pick product, facility, quantity, date.
7. The client calls `GET /api/production/eligibility?productId=…&facilityId=…&quantity=…&date=…`.
   Nothing is written. The full ordered check list comes back.
8. Every check PASSes → **Create Production Order** is enabled. Creating it re-evaluates
   server-side (the preview may be minutes stale), stores the decision, and links it to the
   order.
9. A check FAILs → the failing check is shown with its message and its remedy link. Under
   STRICT the button is disabled. Under ADVISORY it is enabled but carries the warning, the
   order is created, and a `ComplianceFinding` is written — today's behaviour, now explained.

**The worked example.** Inyange Foods, licensed as a food manufacturer at the organization
grain; Kigali holds a DAIRY-scoped facility licence valid to 12 Dec 2026; Huye's application
is SUBMITTED pending inspection. Yogurt 500ml is a DAIRY product.

*Yogurt at Kigali, 10 000 units, 1 Sep 2026:*

```
ORGANIZATION_LICENCE                 PASS  Inyange Foods holds LIC-MFG-00042, valid to 2026-12-12
FACILITY_AUTHORIZATION               PASS  Kigali Dairy Plant is authorized for manufacturing
PRODUCT_CATEGORY_COVERAGE            PASS  LIC-MFG-00042 covers DAIRY
PRODUCT_AUTHORIZATION                 N/A  No product authorization is required for DAIRY
LICENCE_VALIDITY_AT_REQUESTED_DATE   PASS  Valid on 2026-09-01
PRODUCT_TRACEABILITY                 PASS  Yogurt 500ml is BATCH-traced; one identity for 10 000 units
BATCH_AND_RECALL_RESTRICTIONS        PASS  No open recall affects this product
→ READY TO PRODUCE
```

*The same request at Huye:*

```
ORGANIZATION_LICENCE                 PASS  Inyange Foods holds LIC-MFG-00042, valid to 2026-12-12
FACILITY_AUTHORIZATION               FAIL  Huye Dairy Plant is not authorized for DAIRY production.
                                           Application LIC-MFG-00051 is with the regulator,
                                           submitted 2026-08-02, awaiting inspection.
                                           → [View application]
…
→ CANNOT PRODUCE — 1 of 7 checks failed
```

The organization licence passing while the run is refused is the whole point of section 2 of
the brief, and it is only representable once a licence can name a site.

---

## 11. Regulator workflow

Designed, largely deferred. The most important finding here is not a missing screen.

**Jurisdiction does not exist, and the current behaviour is a live privacy problem.**
`queue()` (`license.service.ts:241`) hands every pending application on the platform to any
of the five REGULATOR organizations, and `GET /api/regulator/licenses/:id/documents` hands
over the applicants' uploaded certificates. `decide()`, `suspend()` and `revoke()` gate on
nothing but organization type. This is a change to regulator visibility, which is an
explicit stop condition for this audit: it is **recorded here and not proposed as an
implementation task**. It needs its own decision.

**How jurisdiction should eventually be expressed** (design only): a `RegulatoryAuthority`
bound one-to-one to a REGULATOR `Organization`, owning `RegulatoryRequirement` rows; each
requirement scoped to product categories and activities. An authority's jurisdiction is then
*derived*, not declared — it is the set of licence categories, product categories and
activities its requirements touch. `queue()` filters to applications whose category falls in
that set. This keeps `ProductCategory` platform-owned and keeps DAIRY→authority a
relationship through requirements, never a column.

**Dashboard** (post-MVP unless marked):

| Panel | Source today | Status |
| --- | --- | --- |
| Applications pending review | `queue()` — exists, unscoped | MVP, scoping deferred |
| Compliance findings | `recentFindings()` (`license-enforcement.service.ts:203`) — exists | MVP |
| Organizations under jurisdiction | `OrganizationService.registry()` — exists, unscoped | MVP, scoping deferred |
| Expiring licences | derivable from `expires_on`; no endpoint | POST-MVP |
| Suspended / revoked authorizations | derivable from `status`; no endpoint | POST-MVP |
| Facilities under jurisdiction | needs `licenses.facility_id` | POST-MVP |
| Product authorizations | needs §4.3 | POST-MVP |
| Recent production activity | `ProductionOrder` exists; no cross-org read | POST-MVP |
| Recall alerts | recall module exists | POST-MVP |
| Products by category / facilities by category | needs §4.3 and requirements | FUTURE |
| Requirements owned by this authority | needs `RegulatoryRequirement` | FUTURE |

**Actions.** Review application, read submitted documents, start review, approve, reject,
**request changes** (new, §8.1), suspend, reinstate, revoke, renew, view full history — all
but "request changes" already implemented. Review of a *facility* and of a *product* are the
same three endpoints once the licence grain widens; that is the practical payoff of section
4.1 for the regulator side.

**Attribution.** Every decision must name: the regulator organization, the regulator user,
the timestamp, the decision, the reason, the affected authorization, and the rule and version
applied. Section 19 audits what of that is captured today (not all of it).

---

## 12. Production eligibility workflow

```
Manufacturer                    API                              Data
─────────────                   ───                              ────
Start Production
  product, facility,
  quantity, date
        │
        ├─ GET /api/production/eligibility ──► ProductionEligibilityService.evaluate()
        │                                            │
        │                                            ├─ assess(org, MANUFACTURING)      licenses
        │                                            ├─ governing licence for facility  licenses.facility_id
        │                                            ├─ category coverage               license_categories
        │                                            │                                    .permitted_product_categories
        │                                            ├─ product authorization (post-MVP) licenses.product_id
        │                                            ├─ validity at requestedDate        License.isWithinDates(date)
        │                                            ├─ traceability level               products.traceability_level
        │                                            └─ recall / batch restrictions      batches, recalls
        │
        ◄── { eligible, blocking, checks[] }        NOTHING WRITTEN
        │
   all PASS ──► [Create Production Order]
        │
        ├─ POST /api/production/orders ─────► ProductionService.create()
        │                                            │
        │                                            ├─ evaluate() again, server-side
        │                                            ├─ if blocking → refuse with the failing checks
        │                                            ├─ if !eligible && !blocking → ComplianceFinding + notify
        │                                            ├─ INSERT production_eligibility_decisions  (immutable)
        │                                            ├─ INSERT production_orders (+ decision FK)
        │                                            └─ INSERT batches                     (existing behaviour)
        ◄── order + the decision that permitted it
```

Two evaluations, not one, and deliberately: the preview is advisory and cheap, the
create-time evaluation is authoritative and is the one that gets stored. A licence can lapse
between the two.

**Governing-licence resolution**, stated precisely because it is the subtlest rule in the DR:

> For an activity at a facility, the governing licence is the facility-scoped licence for
> that (activity, facility) if any exists in a decided state; otherwise the
> organization-scoped licence for that activity. A facility-scoped licence, once it exists,
> *replaces* the organization-wide one for that site — it does not merely add to it.

Without the replacement rule, suspending Huye would achieve nothing: the org-wide licence
would still pass and the site would carry on producing.

---

## 13. Frontend information architecture

Read against the live sidebar (`tracer/frontend/src/components/app-sidebar.tsx`) and route
tree. Today there is a flat "Licenses & Permits" link under Operations & Records, a
"Regulators → License Review" entry, and **no Facilities screen and no Compliance section
at all**.

### 13.1 Manufacturer

Recommended: a **Compliance** area in the main navigation, not a link buried in Operations.
The brief asks whether "Regulatory Applications" belongs in main nav; the answer is that
*applications* alone do not — applications are one tab of a larger question the manufacturer
asks constantly, which is "where do I stand".

```
Compliance                                    requires VIEW_OPERATIONS
├── Overview            authorization status at a glance          MVP
├── Licences            /dashboard/licenses — exists today        MVP
├── Facilities          per-site authorization status             MVP
├── Product Authorizations                                        POST-MVP
├── Applications        drafts, submitted, changes requested      POST-MVP
└── Compliance History  findings, suspensions, decisions          POST-MVP
```

**Compliance → Overview** is the screen section 8 of the brief describes:

```
Organization                Inyange Foods
Manufacturing licence       ACTIVE · LIC-MFG-00042 · valid to 12 Dec 2026
                            ⚠ Provisional — apply for a full licence before 2026-11-14
Facilities
  Kigali Dairy Plant        AUTHORIZED · dairy · valid to 12 Dec 2026
  Huye Dairy Plant          PENDING · inspection required · submitted 2 Aug 2026   [View application]
Products
  Yogurt 500ml              AUTHORIZED · dairy
  Strawberry Yogurt         AUTHORIZATION EXPIRED · 30 Jun 2026   [Renew]
```

The provisional line is not decoration. With 180 of 182 licences provisional, a UI that
renders "ACTIVE" and stops is telling almost every user on the platform that they are fully
licensed when they are inside a 90-day grace period. `describe()` already returns
`provisional` (`license.controller.ts:293`); the screen must use it.

**Start Production** becomes a four-field form followed by the live check list, then either
`READY TO PRODUCE → [Create Production Order]` or `CANNOT PRODUCE` with the failing check and
its remedy button (`[View authorization]` / `[Start authorization application]`). The
existing `/dashboard/manufacturing/production` screen keeps its list of orders; this is the
creation path into it.

### 13.2 Regulator

```
Overview        queue depth, findings, expiring, suspended        MVP (panels exist)
Applications    review queue → application detail → decision      MVP (unscoped, §11)
Organizations   registry under jurisdiction                       MVP (unscoped)
Facilities      per-site authorization                            POST-MVP
Products        product authorizations                            POST-MVP
Requirements    rules this authority owns                         FUTURE
Licences        every licence issued under this authority         POST-MVP
Inspections                                                       FUTURE (deferred entity)
Compliance      findings, with the run that caused them           POST-MVP
Recalls                                                           POST-MVP
Reports                                                           POST-MVP
```

### 13.3 Platform administrator

```
Organizations           /dashboard/industries — exists            MVP
Users                   /dashboard/users — exists                 MVP
Roles                   /dashboard/roles — exists                 MVP
Canonical Categories    product categories; no admin UI today     POST-MVP
Regulatory Authorities  /dashboard/regulators — partly exists     POST-MVP
System Configuration    incl. EnforcementMode, visible not editable  POST-MVP
Audit                   /dashboard/audit — exists                 MVP
```

Enforcement mode deserves a note: `enforcementMode()` is already surfaced to regulators
(`license.controller.ts:201`). It should be visible to platform administrators too, because
"why did that production order go through" has ADVISORY as its answer far more often than
anyone expects.

---

## 14. API and service implications

**New, MVP:**

| Endpoint | Capability | Notes |
| --- | --- | --- |
| `GET /api/production/eligibility` | `RUN_PRODUCTION` | query: productId, facilityId?, quantity, date. Pure read |
| `GET /api/compliance/overview` | `VIEW_OPERATIONS` | org status + per-facility + per-product, for the dashboard |
| `POST /api/facilities` | `MANAGE_CATALOG` | the missing write path (§1.5) |
| `PATCH /api/facilities/:id` | `MANAGE_CATALOG` | rename, address, deactivate |

**Changed, MVP:**

- `POST /api/licenses` — `ApplyForLicenseDto` gains optional `facilityId`.
- `POST /api/production/orders` — evaluates eligibility, stores the decision, links it,
  refuses only when `blocking`.
- `GET /api/licenses` — each entry gains `facilityId`, `facilityName`, and an explicit
  `grain: 'ORGANIZATION' | 'FACILITY' | 'PRODUCT'`.

**New service:** `ProductionEligibilityService`, in `src/licensing/services/`. It belongs to
licensing, not manufacturing: it reads licences, categories and findings and is consumed by
manufacturing, which is the same direction the existing dependency already runs
(`ProductionService` imports `LicenseEnforcementService`, not the reverse).

**Avoiding scatter — the mechanism, not the intention.** Three rules, each testable:

1. `ProductionEligibilityService` is the only class outside `src/licensing/` allowed to be
   the *source* of a production-eligibility answer. A lint rule or an architecture test can
   assert that no file outside `src/licensing/` imports `License`, `LicenseCategory` or
   `LicenseStatus`. Today that would pass trivially — the only importers are
   `ProductionService` (the service, not the entities) and `ExpiryService`.
2. The controller never re-derives a verdict. It renders `checks` and inspects `blocking`.
3. The frontend never recomputes eligibility, for the same reason it does not recompute
   capabilities — the sidebar's own comment records what happened last time a second copy of
   the rules existed in the browser (`app-sidebar.tsx`, `hasAccess`).

**Duplicate to retire while in the area:** `activityForType()` (`license.service.ts:776`) and
`requiredActivityFor()` (`license-enforcement.service.ts:174`) are the same function.

---

## 15. Migration implications

All MVP changes are additive. None drops a column, narrows a type, or rewrites a row.

**M1 — `licenses.facility_id`**

```sql
ALTER TABLE "licenses" ADD COLUMN "facility_id" int NULL
  REFERENCES "facilities"("id");
CREATE INDEX "idx_license_facility" ON "licenses" ("facility_id");
```

No backfill. NULL is correct for all 182 existing rows: none was issued against a site.

**The five queries that change meaning the moment this column exists.** This is the real cost
of M1 and it must not be discovered later:

| Location | Today | Must become |
| --- | --- | --- |
| `apply()` duplicate check, `license.service.ts:106` | one open application per (org, category) | per (org, category, facility) — otherwise Inyange cannot apply for Huye while holding Kigali's |
| `issueProvisional()` existence check, `:667` | returns null if *any* licence exists for the org | unchanged in effect, but must explicitly mean *organization-grained*, or a facility licence would suppress onboarding grace |
| `effectiveLicense()`, `:470` | best licence for (org, activity) | must take an optional facilityId and apply the replacement rule of §12 |
| `assess()`, `license-enforcement.service.ts:133` | ranks all licences for (org, activity) | same; a Kigali-only licence must not authorise Huye |
| `listFor()`, `:531` | all licences for an org | unchanged, but the response must carry the grain so the UI can group by site |

Until every one of those is updated, adding the column makes the system *less* correct, not
more — a facility-scoped licence would be silently read as organization-wide. M1 and its five
query changes are one unit of work.

**M2 — `production_eligibility_decisions` + `production_orders.eligibility_decision_id`**
New table, one nullable FK. Existing orders keep NULL, which is honest: they were created
before any eligibility decision was ever made.

**M3 (post-MVP) — `licenses.product_id`** plus a unique partial index preventing two live
authorizations for the same (organization, product, category).

**M4 (post-MVP) — enum additions.**
`ALTER TYPE "licenses_status_enum" ADD VALUE 'CHANGES_REQUESTED';`
`ALTER TYPE "licenses_status_enum" ADD VALUE 'WITHDRAWN';`
Additive; note that in PostgreSQL an added enum value cannot be used in the same transaction
that adds it, so this is its own migration.

**M5 (post-MVP) — `license_events` snapshot columns** (`issued_on`, `expires_on`,
`decided_by_organization_id`) and **`compliance_findings`** (`facility_id`,
`production_order_id`). All nullable, no backfill possible or attempted — historical rows
genuinely do not carry that information and pretending otherwise would fabricate audit data.

**Not proposed:** dropping `LicenseCategory.permittedProductCategories`. Section 4.2 gives it
a reader. **Not proposed:** dropping the deprecated `Product.category` string — that is DR-05
business and needs its own approval.

---

## 16. Historical compliance implications

The requirement: a 2026 run, audited in 2028, must be judged against the rules and
authorizations that applied in 2026.

**What survives today.**

- `TraceabilityEvent` — append-only, never updated, protected by convention and by
  `update: false` on its scalars. The run's physical history is safe.
- `LicenseEvent` — append-only, records `fromStatus`, `toStatus`, `actor`, `notes`,
  `recordedAt`. "Was LIC-MFG-00042 ACTIVE on 2026-03-04?" is reconstructable by replaying it.
- `License` renewal creates a new row with `previousLicense` rather than editing
  (`license.service.ts:443`). Windows of authorisation survive as separate rows.
- `ComplianceFinding` — append-only, with a deliberate absence of a `resolved` flag.
- `Batch.facilityId` and `ProductionOrder.facilityId` — the run's site survives.

**What does not.**

1. **The rule.** `LicenseCategory` is mutable, unversioned seed data. Change
   `permittedProductCategories`, `requiredDocuments` or `validityMonths` and there is no
   record of what it said before. Since `PRODUCT_CATEGORY_COVERAGE` reads exactly that field,
   re-evaluating a 2026 run in 2028 would apply the 2028 rule. This is the requirement-v1 /
   requirement-v2 problem in the brief, and it exists *today*, on `LicenseCategory`, before
   `RegulatoryRequirement` is ever built.
2. **The dates.** `LicenseEvent` records status transitions but never `issued_on` /
   `expires_on`. `decide()` sets both on the licence row (`:322-324`) and may take an operator
   override. So "the licence was ACTIVE" is reconstructable but "the licence was valid *on the
   requested production date*" is not.
3. **The deciding organization.** `License.issuedBy` names the approving regulator, but it is a
   mutable column on a mutable row, and a later suspension by a *different* authority does not
   record its organization anywhere. `LicenseEvent.actor` is a `User`, whose organization can
   change; deriving the authority through it is deriving history through a mutable FK.
4. **The verdict itself.** Nothing records that a run was ever judged eligible, on what basis.

**Minimum fields to preserve historical regulatory truth.**

Required (MVP), all in `production_eligibility_decisions` (§4.4):
`organization_id`, `facility_id`, `product_id`, `requested_quantity`, `requested_date`,
`eligible`, `blocking`, `enforcement_mode`, `checks` (jsonb, verbatim), `relied_on` (jsonb:
licence ids *and* numbers *and* category codes — ids alone are not enough if a row is later
deactivated), `ruleset_version`, `evaluated_at`, `evaluated_by_id`.

Required (post-MVP), minimal additions:
`license_events.issued_on`, `license_events.expires_on`,
`license_events.decided_by_organization_id`;
`compliance_findings.facility_id`, `compliance_findings.production_order_id`.

`ruleset_version` is a deliberately cheap placeholder: a string that changes whenever the
evaluated rule set changes. Before `RegulatoryRequirement` exists it can be a constant bumped
by hand; afterwards it becomes the set of requirement versions applied. Recording it now costs
one column and is what lets a future bitemporal model reconstruct the past it inherits.

**The governing principle**, stated so it is testable: *re-evaluating a historical production
run reads the stored decision. It never calls `evaluate()` again.* Today's state must never
rewrite historical production truth, and the only reliable way to guarantee that is to make
the historical answer a stored fact rather than a recomputation.

**Interaction with recall.** A recall in 2028 of a 2026 batch reaches the batch through
`facilityId` and the batch's own events. With M2 in place it also reaches the eligibility
decision, which names every authorization the run relied on — which is precisely the question
an investigator asks second, after "which plant made it".

---

## 17. Provisional implications

The confirmed interpretation is preserved without alteration: PROVISIONAL is
**platform-granted onboarding grace**. It is not regulator-issued (`issuedBy` is null), not
regulator-approved (no `startReview`, no `decide`), not a product authorization, not a
permanent manufacturing licence, and it is never converted into a full licence — the holder
applies separately and `apply()` deliberately lets the two coexist (`license.service.ts:93-105`).
It exists so a new organization is not completely blocked before completing licensing.

**Two facts must govern any recommendation here.**

First, `provisional` is read by no enforcement path. `assess()` and `judge()` cannot tell a
grace period from a regulator's decision.

Second, 180 of 182 licences are provisional. Any rule of the form "provisional may not X"
stops 98.9% of the platform on the day it ships.

**Recommendation — what a provisional organization should be allowed to do.**

| Action | Allowed? | Reasoning |
| --- | --- | --- |
| Create products | Yes | A catalogue entry is a claim, not an act. `SELF_DECLARABLE_TYPES`' comment already establishes that declaring is not permission |
| Create facilities | Yes | Declaring your sites is a precondition of being inspected, not a reward for passing |
| Submit licence applications | Yes, and this is the point | The provisional licence's own `statusReason` instructs the holder to apply; `apply()` was fixed so grace does not block it |
| Create production orders | Yes, with a WARN | A production order is a plan. Blocking planning would prevent a business from preparing for the day its licence is approved |
| Actually manufacture (start/complete a run) | Yes under ADVISORY with a WARN; refused under STRICT | Exactly today's behaviour. Changing it is a policy decision, not an architecture one |
| Hold, move and transfer stock | Yes | Never gated today; nothing in this DR proposes gating it |
| Sell / distribute | Yes | Same. And `permitsReturns()` (`licensing.enums.ts:38`) already establishes that even a suspended holder must be able to take goods back |
| **Satisfy `PRODUCT_AUTHORIZATION`** | **No — must FAIL** | A product authorization is a specific authority's decision about a specific product. Grace is neither |
| **Satisfy `FACILITY_AUTHORIZATION` for a category that requires one** | **No — must FAIL** | Same reasoning. Grace covers the business, never the site's fitness for dairy |

So the rule in one line: **provisional produces `WARN` on `ORGANIZATION_LICENCE`, and `FAIL`
on any check that names a specific authority's decision.** Until product and requirement
authorizations exist, those checks are `NOT_APPLICABLE` and provisional behaves exactly as it
does today — which is what makes this recommendation safe to adopt before them.

**And it must be labelled.** A provisional licence rendered as "ACTIVE" is the single most
misleading thing in the current UI, because it is true of 98.9% of accounts and it is not what
"active" means to a compliance officer. Compliance → Overview must read
`Provisional — expires 14 Nov 2026 — apply for a full licence`, and the eligibility check's
message must say the same. This is a display and message change, not a semantic one:
`issueProvisional()`'s behaviour is not altered by anything in this DR.

---

## 18. Security implications

**Regulator visibility is the material finding, and it is pre-existing.** Any of the five
REGULATOR organizations can today read every pending application on the platform, download
every applicant's certificates, and approve, suspend or revoke any licence belonging to any
business. Widening the licence grain does not create this; it *widens its blast radius*,
because facility and product authorizations would flow into the same unscoped queue and carry
more commercially sensitive detail (which sites make what). **Changing regulator visibility is
an explicit stop condition for this audit. It is recorded, not proposed, and it is open
question 1.**

**Document exposure follows the licence, and must keep following it.** `readDocument()`
(`license.service.ts:560`) permits the holder or any REGULATOR. That rule is correct at the
organization grain and stays correct at the facility and product grains — but only because it
is written once. Any new authorization endpoint that streams documents must call the same
method, not re-implement the predicate.

**Cross-tenant leakage through the new surfaces.** Three specific risks:

- `GET /api/production/eligibility` takes a `facilityId` and a `productId`. Both must be
  verified to belong to the acting organization *before* any evaluation runs, or the response
  becomes an oracle: "does facility 87 exist and is it authorized for dairy" is a competitor
  intelligence question. `production.service.ts:736` already does this correctly for
  production orders and is the pattern to copy.
- A licence must never reference a facility outside its own organization. Nothing in the
  database prevents it once the column exists; it needs a check in `apply()` and, ideally, a
  constraint or trigger.
- The eligibility `message` strings are shown to the manufacturer and stored in `checks`.
  They must never name another organization, another organization's licence number, or the
  identity of an inspector. "Awaiting inspection" is fine; "awaiting inspection by J. Uwase"
  is not.

**Capability posture is unchanged.** No new authorization entity, no new role, no widening of
an existing capability. The one question raised — whether regulator decisions should hang off
`MANAGE_RECALL` — is deliberately left as an open question rather than changed here.

**Enforcement mode is a security-relevant setting.** `EnforcementMode` is read once at service
construction from config (`license-enforcement.service.ts:68`) and cannot be changed at
runtime, which is the right property. It should stay that way; an eligibility service that
could be switched to permissive at runtime would be a bypass.

---

## 19. Audit requirements

Every regulatory decision must be attributable to: **regulator organization, regulator user,
timestamp, decision, reason, affected authorization, and applicable rule and version.**
Measured against `LicenseEvent`:

| Required | Captured today? | Where / what is missing |
| --- | --- | --- |
| Regulator organization | **Partly** | `License.issuedBy` names the approver only, on a mutable column. A suspension or revocation by another authority records no organization at all |
| Regulator user | Yes | `LicenseEvent.actor` |
| Timestamp | Yes | `LicenseEvent.recordedAt`, `CreateDateColumn` |
| Decision | Yes | `LicenseEvent.type` + `fromStatus`/`toStatus` |
| Reason | Yes | `LicenseEvent.notes`; mandatory for reject, suspend, revoke (`:305`, `:346`, `:402`) |
| Affected authorization | Yes | `LicenseEvent.license`, NOT NULL |
| Applicable rule and version | **No** | `LicenseCategory` is unversioned and the event does not name it |

Minimum additions (post-MVP, all nullable and additive):
`license_events.decided_by_organization_id`, `license_events.issued_on`,
`license_events.expires_on`, `license_events.ruleset_version`.

**Append-only must be enforced, not intended.** `TraceabilityEvent` marks its scalars
`update: false` so the ORM itself refuses a second write. `LicenseEvent` does not, and neither
would `production_eligibility_decisions` by default. Both should carry the same protection,
and the eligibility table should additionally be protected at the database level — it is the
one table whose whole value is that it cannot be edited after the fact.

**Existing infrastructure to reuse:** `src/security/audit.interceptor.ts` and `AuditLog`
already exist. Eligibility evaluations that *deny* should be audited there as well as stored;
evaluations that pass need only the stored decision, or the audit log becomes a write-heavy
duplicate of a table that already has the data.

---

## 20. MVP scope

Ordered so each step is independently shippable.

1. **Facility write endpoints.** `POST /api/facilities`, `PATCH /api/facilities/:id`, guarded
   by `MANAGE_CATALOG`. Without this the entire multi-facility model is unreachable — 211
   organizations, 211 facilities, no way to add a second.
2. **`licenses.facility_id`** (M1) *together with* the five query changes in section 15. One
   unit of work; shipping the column alone makes the system less correct.
3. **`ApplyForLicenseDto.facilityId`**, and `describe()` returning the grain.
4. **`ProductionEligibilityService`** with six live checks: `ORGANIZATION_LICENCE`,
   `FACILITY_AUTHORIZATION`, `PRODUCT_CATEGORY_COVERAGE`,
   `LICENCE_VALIDITY_AT_REQUESTED_DATE`, `PRODUCT_TRACEABILITY`,
   `BATCH_AND_RECALL_RESTRICTIONS`. `PRODUCT_AUTHORIZATION` and `PER_PRODUCTION_APPROVAL`
   return `NOT_APPLICABLE`.
5. **Wire up `permittedProductCategories`** — no schema change; the field has been waiting
   since the licensing migration.
6. **`GET /api/production/eligibility`** — pure read, no writes.
7. **`production_eligibility_decisions` + FK** (M2), and `ProductionService.create()`
   evaluating, storing, linking, and refusing only when `blocking`.
8. **`GET /api/compliance/overview`.**
9. **Frontend: Compliance → Overview and Facilities**, with provisional shown as provisional.
10. **Frontend: Start Production** wizard rendering the check list.

Explicitly *not* MVP: product authorizations, per-production approval, jurisdiction,
`CHANGES_REQUESTED`, regulator dashboards beyond what exists.

## 21. Post-MVP scope

- `licenses.product_id` (M3) and the `PRODUCT_AUTHORIZATION` check going live.
- `LicenseStatus` += `CHANGES_REQUESTED`, `WITHDRAWN`; `ReviewDecision` += `REQUEST_CHANGES`
  (M4).
- `license_events` snapshot columns; `compliance_findings.facility_id` and
  `.production_order_id` (M5).
- Manufacturer Compliance → Product Authorizations, Applications, Compliance History.
- Regulator Facilities, Products, Licences, Compliance and Recalls dashboards.
- Expiring-authorization notifications, extending the existing near-expiry notification
  pattern in `ExpiryService`.
- Retire the duplicated `activityForType` / `requiredActivityFor` pair.

## 22. Future scope

- `RegulatoryAuthority`, `RegulatoryRequirement`, `RequirementEvent`, requirement versioning,
  requirement→ProductCategory scoping — all deferred by explicit instruction; designed in
  sections 7 and 10, built by nobody until separately approved.
- Jurisdiction-scoped regulator queue and registry, derived from owned requirements.
- `ProductionApplication` and per-production approval, activated only where
  `requirement.perProductionApproval` is true (section 6 of the brief; §8.4 here).
- Inspections, certifications, regulatory notifications, `ProductFamily`, `ProductGtin`,
  `OrganizationRole` — deferred.
- Full bitemporal evaluation (alternative C3), superseding `ruleset_version`.

---

## 23. Open questions

Each answerable in one line.

1. **Regulator jurisdiction.** Today any of the five REGULATOR organizations can read and
   decide every application on the platform. Is that acceptable for MVP, or must the queue be
   scoped before facility and product authorizations widen what it exposes?
2. **Enforcement mode for production eligibility.** Should ineligible production stay
   ADVISORY (create the order, record a finding, warn) — or is production the one activity
   that should be STRICT regardless of the global mode?
3. **Provisional and full licences at the same grain.** An organization can hold both a
   provisional and a full manufacturing licence simultaneously. When the full one is
   approved, should the provisional be closed out, or left to lapse on its own date?
4. **Facility licence categories.** Should a facility-scoped licence use the same
   `LicenseCategory` rows as an organization-scoped one (`MFG`), or should there be separate
   site categories with their own required documents (e.g. `MFG-SITE` demanding
   `PREMISES_INSPECTION`)?
5. **Category coverage default.** `permittedProductCategories` empty currently means
   "unrestricted", which is documented as right for warehousing and distribution. Should
   empty stay unrestricted for *manufacturing* too, or should manufacturing require an
   explicit category list once the field is read?
6. **Product authorization holder.** Is a product authorization held by the organization (and
   therefore valid at every one of its authorized sites), or by an (organization, facility)
   pair?
7. **Product authorization scope.** Does it authorize *manufacturing*, *placing on market*, or
   both — and can a product be authorized to be made but not sold?
8. **`ruleset_version` before requirements exist.** Should it be a hand-bumped constant, a
   hash of the evaluated `LicenseCategory` rows, or the deployed application version?
9. **Regulator decision capability.** Regulator review routes are gated on `MANAGE_RECALL`.
   Should a dedicated `DECIDE_APPLICATIONS` capability be introduced, or is the existing
   pairing with `requireRegulator()` sufficient?
10. **Facility deactivation.** What happens to a facility-scoped licence when its facility is
    deactivated — does the licence lapse, get revoked, or stay dormant pending reactivation?
11. **Backdated production.** `requestedDate` can be in the past. Should eligibility be
    evaluated against the requested date, today, or both — and may a run be recorded for a
    date on which the licence was not valid?
12. **`Product.category` (deprecated string).** DR-05 leaves it in place. Does
    `PRODUCT_CATEGORY_COVERAGE` fail closed for the 92 of 111 products that have no
    `categoryId`, or pass with a `WARN`?

---

## 24. Explicit invariants

Falsifiable. Each is a statement a test or a constraint can disprove.

**Grain and ownership**

1. No `License` may reference a facility outside its own organization:
   `licenses.facility_id IS NULL OR (SELECT organization_id FROM facilities WHERE id =
   licenses.facility_id) = licenses.organization_id`.
2. No `License` may reference a product outside its own organization (once `product_id`
   exists), by the same form.
3. A facility-scoped licence never authorizes work at any other facility of the same
   organization: `evaluate()` for facility B must not return PASS on `FACILITY_AUTHORIZATION`
   on the strength of a licence whose `facility_id` is A.
4. Where a facility-scoped licence exists in a decided state for (activity, facility), it —
   and not the organization-scoped licence — determines `FACILITY_AUTHORIZATION` for that
   facility.
5. Suspending a facility-scoped licence changes no check result for any other facility of the
   same organization.

**Eligibility**

6. Every `ProductionOrder` created after this DR references exactly one
   `production_eligibility_decision`, and that decision's `organization_id`, `facility_id` and
   `product_id` equal the order's.
7. `evaluate()` returns the complete ordered check list in every case, including when the
   first check fails. It never short-circuits.
8. `blocking` is true if and only if (`eligible = false` and mode = STRICT) or any check
   failed on a REVOKED licence.
9. Under ADVISORY, `eligible = false` produces exactly one `ComplianceFinding` and one created
   `ProductionOrder`.
10. No class outside `src/licensing/` imports `License`, `LicenseCategory` or `LicenseStatus`
    to reach a production-eligibility verdict.
11. `GET /api/production/eligibility` writes no row to any table.

**Provisional**

12. A provisional licence never returns PASS on `PRODUCT_AUTHORIZATION` or, once a requirement
    demands one, on `FACILITY_AUTHORIZATION`.
13. A provisional licence never returns FAIL on `ORGANIZATION_LICENCE` while it is within its
    dates; it returns WARN.
14. No provisional licence is ever mutated into a non-provisional one:
    `UPDATE licenses SET provisional = false` appears nowhere in the codebase.

**History**

15. A `production_eligibility_decisions` row is never updated or deleted after insert.
16. Re-examining a historical production run reads its stored decision; `evaluate()` is never
    called with a past `requestedDate` to reconstruct a verdict.
17. No `LicenseEvent` is ever updated or deleted.
18. Every regulator decision writes exactly one `LicenseEvent`.

**Taxonomy**

19. `product_categories` has no column referencing an organization, a regulator or an
    authority.
20. No code path maps a `ProductCategory` code to a specific authority by literal value; the
    relationship exists only through requirements.

**Untouched core**

21. Nothing in this DR writes to, updates, or changes the shape of `TraceabilityEvent`,
    `TraceableItem`, the packaging hierarchy, permanent identity or the batch lifecycle.
22. `ProductionOrderStatus` gains no regulatory member.

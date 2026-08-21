# SANTRACK · DR-07 · Implementation Contract & Migration Plan

**Status:** APPROVED — all six gates signed 21 Aug 2026 (§1, §12). No code, schema, migration
or frontend has been written. This document is the contract that code will be checked
against, not the code.

**Governing decision record:** `DR-07-authorization-and-production-eligibility.md`.
Architecture direction approved. This contract turns §20 of that DR into ten work units —
each independently testable and independently revertible, with explicit dependencies —
carrying exact interfaces, exact DDL, done-conditions, tests and reverts.

**The rule this document preserves:** no implementation begins until §1 is signed.

---

## 1. Approval gates

Two decisions are business/regulatory policy, not engineering choices. Neither is assumed
anywhere below; each work unit that depends on one names it as a precondition.

### D1 — The facility-scoped licence replacement rule  ☑ SIGNED — 21 Aug 2026

> For an activity at a facility, the governing licence is the facility-scoped licence for
> that (activity, facility) if one exists in a decided state; otherwise the
> organization-scoped licence for that activity. A facility-scoped licence, once it exists,
> **replaces** the organization-wide one for that site — it does not merely add to it.

**Why it must be signed rather than assumed.** It is the rule that gives a facility
suspension any force at all: without replacement, suspending Huye changes nothing, because
the organization-wide manufacturing licence still passes and the site keeps producing. But
it also has a consequence in the other direction that a business will feel — the moment a
site gets its own licence, that site stops inheriting the organization's. A lapsed site
licence therefore stops that site even while the company remains fully licensed nationally.

**What signing it authorises:** WU-2, WU-3, and the `FACILITY_AUTHORIZATION` check in WU-4.

**Signed as proposed.** Replacement is the rule. The consequence above was stated at
signing and accepted: a site with its own licence no longer inherits the organization's, so
a lapsed site licence halts that site while the company remains nationally licensed. The
rejected alternative was additive resolution (either licence may authorise), which would
have left facility suspension with no force and required DR-07 §24 invariants 3, 4 and 5 to
be rewritten.

### D2 — Provisional behaviour under eligibility  ☑ SIGNED — 21 Aug 2026

180 of 182 licences on the platform are provisional. Exactly one organization holds a
regulator-approved licence. Enforcement cannot currently tell grace from approval:
`assess()` and `judge()` never read `License.provisional`.

**Proposed for this contract — the conservative option:** DR-07 changes no enforcement
policy. `ORGANIZATION_LICENCE` returns **WARN, not FAIL**, for an in-date provisional
licence (DR §24 invariant 13), so nothing that produces today stops producing. The
distinction becomes *visible* — the manufacturer and the regulator both see "provisional,
expires 12 Dec 2026" instead of a bare pass — without becoming *enforcing*.

**Why it must be signed rather than assumed.** WARN is a policy choice with a real cost: a
platform on which 98.9% of licences are grace records will show a warning on almost every
production run, and warnings that appear everywhere are read nowhere. The alternative —
FAIL, non-blocking under ADVISORY — is more honest and considerably louder.

**Signed as proposed: WARN.** DR-07 changes no enforcement policy. The accepted cost is that
a warning will appear on nearly every production run until organizations hold real licences;
the rejected alternative (FAIL, non-blocking under ADVISORY) would have written a
`ComplianceFinding` for roughly 98.9% of runs.

**What signing it authorises:** the `ORGANIZATION_LICENCE` check in WU-4.

**Not in scope either way:** changing what a provisional licence permits, converting
provisional licences, or altering `issueProvisional()`. DR §24 invariant 14 stands.

---

## 2. Scope lock

**MVP — in.** Facility write endpoints · `licenses.facility_id` · facility-aware licence
queries · `ProductionEligibilityService` · eligibility preview endpoint · eligibility
evaluated at production-order creation · immutable `production_eligibility_decisions` ·
compliance overview · frontend eligibility display.

**MVP — out, and not to be built while these work units are open.** Product-level
authorization (`licenses.product_id`) · `RegulatoryRequirement` · `RegulatoryAuthority` ·
`RequirementEvent` · jurisdiction scoping · per-production applications · inspections ·
regulator dashboards beyond what exists · `CHANGES_REQUESTED` / `WITHDRAWN` statuses ·
`ProductFamily` · `ProductGtin` · `OrganizationRole`.

Two check codes ship inert by design: `PRODUCT_AUTHORIZATION` and `PER_PRODUCTION_APPROVAL`
always return `NOT_APPLICABLE`. They are present in the ordered list so the response shape
does not change when they go live post-MVP.

---

## 3. Three traps found while writing this contract

These are not in the DR. Each would be discovered late and expensively.

### T1 — `evaluate()` must call `assess()`, never `check()`

`check()` (`license-enforcement.service.ts:88`) is unusable as an eligibility input for
three independent reasons:

- Under `EnforcementMode.OFF` it returns a **fabricated** `LICENSED` verdict without
  assessing anything (`:94`). The DR requires `eligible` to be computed identically in all
  modes; routing through `check()` makes it a lie in one of the three.
- It **throws** on REVOKED and under STRICT. A check list cannot be assembled from a
  function that terminates the request partway through it.
- It **writes**: `recordFinding()` then `notifyHolder()` (`:113-114`) before any refusal.

That last point is the trap. `GET /api/production/eligibility` is a preview the Start
Production screen will call on every field change. Routed through `check()`, opening the
form would write a `ComplianceFinding` and notify the licence holder — per keystroke.
DR §24 invariant 11 (*the preview writes no row to any table*) exists to catch this, and it
must be an integration test asserting table counts before and after, not a code comment.

**Contract:** `ProductionEligibilityService` depends on `assess()` and on read-only entity
methods. Finding-writing and notification stay in `ProductionService.create()`, on the
authoritative evaluation only, exactly once (DR §24 invariant 9).

### T2 — There are already two different answers to "which licence governs"

| | Ordering | Ranking | Statuses considered |
| --- | --- | --- | --- |
| `assess()` (`:133`) | `ORDER BY expires_on DESC` | ranks by verdict; best wins | ACTIVE, SUSPENDED, EXPIRED, REVOKED |
| `effectiveLicense()` (`license.service.ts:470`) | **none** | **none** — returns the first row matching the activity | ACTIVE, SUSPENDED |

`effectiveLicense()` returns whichever row Postgres happens to hand back first. With one
licence per organization that was invisible. It stops being invisible the moment an
organization holds a national licence *and* a site licence, because D1 makes the choice
between them load-bearing: a non-deterministic governing licence is a non-deterministic
regulatory verdict.

**Contract:** the D1 resolution rule is implemented **once**. `effectiveLicense()` either
delegates to the same resolver or is retired in favour of it. WU-2 is not done while two
implementations of "which licence governs" exist. `mayReceive()` is its only other caller
and must be re-pointed in the same unit.

### T3 — `permittedProductCategories` is empty on every row, so the default decides the platform

Every active `LicenseCategory` holds `'{}'`, and empty currently means *unrestricted*
(documented as correct for warehousing and distribution). `PRODUCT_CATEGORY_COVERAGE` is
the first reader this field has ever had. Whatever "empty" is made to mean is therefore
applied to 100% of licences on day one, and 92 of 111 products carry no `categoryId` at all.

Open questions 5 and 12 are not details to settle during implementation. They are inputs to
WU-4 and are listed as blocking in §4.

---

## 4. Open questions: which block, which do not

Twelve questions carried from DR §23. Only four block MVP work; the rest have safe defaults
recorded here and may be revisited without rework.

| # | Question | Blocks | Answer |
| --- | --- | --- | --- |
| 5 | Does empty `permittedProductCategories` stay unrestricted for MANUFACTURING? | **WU-4** | **DECIDED 21 Aug 2026:** stays unrestricted, `PASS` — matches today's meaning; changing it would be a policy change wearing a bug fix's clothes |
| 12 | `PRODUCT_CATEGORY_COVERAGE` for the 92 products with no `categoryId` | **WU-4** | **DECIDED 21 Aug 2026:** `WARN`, never `FAIL` — the product is unclassified, which is a catalogue gap, not a regulatory breach |
| 2 | Is production STRICT regardless of global mode? | **WU-6** | **DECIDED 21 Aug 2026:** no. Global mode governs; `blocking = !eligible && mode === STRICT`, plus the unconditional REVOKED carve-out |
| 4 | Same `LicenseCategory` for site licences, or separate site categories? | **WU-3** | *Open.* Default stands: same rows (`MFG`). Separate site categories are a seed-data change that can be added later without schema movement |
| 1 | Regulator jurisdiction / unscoped queue | **WU-3 — hard prerequisite** | **DECIDED 21 Aug 2026: accepted for MVP.** Facility-scoped applications use the existing queue and existing regulator authorization rules. An explicit MVP limitation, not the intended model; see §9 |
| 3 | Close out provisional when a full licence is approved? | — | Leave to lapse on its own date — current behaviour, and the two are designed to coexist |
| 6, 7 | Product authorization holder and scope | — | Post-MVP; `PRODUCT_AUTHORIZATION` ships inert |
| 8 | `ruleset_version` before requirements exist | — | Hand-bumped constant `'DR07-MVP-1'`; a hash of `LicenseCategory` rows is better but needs a stable serialisation nobody has specified |
| 9 | Dedicated `DECIDE_APPLICATIONS` capability | — | Keep the existing `MANAGE_RECALL` + `requireRegulator()` pairing; introducing a capability is DR-03 territory |
| 10 | Facility-scoped licence when its facility is deactivated | — | Stays dormant; deactivating a site is not a regulatory decision and must not forge one. Add to WU-1 tests |
| 11 | Backdated `requestedDate` | — | Evaluate against `requestedDate`; a run recorded for a date the licence did not cover is `eligible = false` and, under ADVISORY, permitted with a finding |

---

## 5. Migration plan

Both MVP migrations are additive. Neither drops a column, narrows a type, or rewrites a row.
Both revert cleanly. Neither requires a backfill.

### M1 — `licenses.facility_id`  *(precondition: D1 signed)*

```sql
-- up
ALTER TABLE "licenses" ADD COLUMN "facility_id" int NULL
  REFERENCES "facilities" ("id");
CREATE INDEX "idx_license_facility" ON "licenses" ("facility_id");

-- down
DROP INDEX "idx_license_facility";
ALTER TABLE "licenses" DROP COLUMN "facility_id";
```

No backfill. `NULL` is factually correct for all 182 existing rows: no licence on the
platform was ever issued against a site, and inventing one would fabricate a regulatory fact.

**Ships as one unit with the five query changes below.** A deployment carrying the column
without them is *less* correct than one carrying neither, because a facility-scoped licence
would be silently read as organization-wide.

| Location | Today | Must become |
| --- | --- | --- |
| `apply()` duplicate check, `license.service.ts:106` | one open application per (org, category), excluding provisional | per (org, category, **facility**) — otherwise Inyange cannot apply for Huye while holding Kigali's |
| `issueProvisional()` existence check, `:667` | returns null if any licence exists for the org | must explicitly mean *organization-grained* (`facility_id IS NULL`), or a site licence suppresses onboarding grace |
| `effectiveLicense()`, `:470` | first matching row, no ordering (**T2**) | takes an optional `facilityId`; applies D1; single implementation shared with `assess()` |
| `assess()`, `license-enforcement.service.ts:133` | ranks all licences for (org, activity) | same, facility-aware — a Kigali-only licence must not authorise Huye |
| `listFor()`, `:531` | all licences for an org | unchanged in result set; response gains `facilityId`, `facilityName`, `grain` |

**Data guard, enforced in code and asserted by test** (DR §24 invariant 1): no licence may
reference a facility outside its own organization. Recommended as an integration test rather
than a DB trigger, since the FK cannot express it.

### M2 — `production_eligibility_decisions`  *(precondition: WU-4 merged)*

```sql
-- up
CREATE TABLE "production_eligibility_decisions" (
  "id"                 bigserial PRIMARY KEY,
  "organization_id"    int NOT NULL REFERENCES "organizations" ("id"),
  "facility_id"        int NULL     REFERENCES "facilities" ("id"),
  "product_id"         int NOT NULL REFERENCES "products" ("id"),
  "requested_quantity" int NOT NULL,
  "requested_date"     date NOT NULL,
  "eligible"           boolean NOT NULL,
  "blocking"           boolean NOT NULL,
  "enforcement_mode"   varchar(16) NOT NULL,
  "checks"             jsonb NOT NULL,
  "relied_on"          jsonb NOT NULL,
  "ruleset_version"    varchar(64) NOT NULL,
  "evaluated_at"       timestamptz NOT NULL DEFAULT now(),
  "evaluated_by_id"    int NULL REFERENCES "users" ("id")
);
CREATE INDEX "idx_ped_organization" ON "production_eligibility_decisions" ("organization_id");
CREATE INDEX "idx_ped_product"      ON "production_eligibility_decisions" ("product_id");

ALTER TABLE "production_orders"
  ADD COLUMN "eligibility_decision_id" bigint NULL
  REFERENCES "production_eligibility_decisions" ("id");

-- down
ALTER TABLE "production_orders" DROP COLUMN "eligibility_decision_id";
DROP TABLE "production_eligibility_decisions";
```

Existing production orders keep `NULL`, which is honest: they were created before any
eligibility decision was ever made. Never backfilled — a reconstructed verdict is a
fabricated audit record.

`relied_on` stores licence **ids and numbers and category codes** together. Ids alone are
insufficient: a `LicenseCategory` can be deactivated, and a decision that can no longer name
what it relied on is not an audit record.

**Append-only, enforced by convention and test** (DR §24 invariants 15, 16): no `UPDATE` or
`DELETE` against this table appears anywhere in the codebase.

### Post-MVP, specified but not authorised

M3 `licenses.product_id` + partial unique index · M4 `LicenseStatus` enum additions (own
migration; Postgres forbids using an added enum value in the transaction that adds it) ·
M5 `license_events` snapshot columns and `compliance_findings.facility_id` /
`.production_order_id`, all nullable, no backfill possible or attempted.

---

## 6. Interface contracts

Frozen here so frontend and backend can be built against the same shape.

```ts
// src/licensing/eligibility.ts
export enum EligibilityCheckCode {
  ORGANIZATION_LICENCE               = 'ORGANIZATION_LICENCE',
  FACILITY_AUTHORIZATION             = 'FACILITY_AUTHORIZATION',
  PRODUCT_CATEGORY_COVERAGE          = 'PRODUCT_CATEGORY_COVERAGE',
  PRODUCT_AUTHORIZATION              = 'PRODUCT_AUTHORIZATION',      // inert in MVP
  LICENCE_VALIDITY_AT_REQUESTED_DATE = 'LICENCE_VALIDITY_AT_REQUESTED_DATE',
  PRODUCT_TRACEABILITY               = 'PRODUCT_TRACEABILITY',
  BATCH_AND_RECALL_RESTRICTIONS      = 'BATCH_AND_RECALL_RESTRICTIONS',
  PER_PRODUCTION_APPROVAL            = 'PER_PRODUCTION_APPROVAL',    // inert in MVP
}

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'NOT_APPLICABLE';

export interface EligibilityCheck {
  code: EligibilityCheckCode;
  status: CheckStatus;
  message: string;                              // written for a manufacturer, not a developer
  remedy?: { label: string; href: string };     // what they do next
}

export interface EligibilityResult {
  eligible: boolean;        // regulatory verdict — identical in OFF, ADVISORY and STRICT
  blocking: boolean;        // whether creation is actually refused
  enforcementMode: 'OFF' | 'ADVISORY' | 'STRICT';
  evaluatedAt: Date;
  checks: EligibilityCheck[];   // always all eight, always this order, never short-circuited
  reliedOn: { licenseIds: number[]; licenseNumbers: string[]; categoryCodes: string[] };
  rulesetVersion: string;
}
```

**Derivation rules, testable as written:**

- `eligible` = no check has status `FAIL`. `WARN` does not defeat eligibility.
- `blocking` = (`!eligible && mode === STRICT`) **or** any check failed on a REVOKED licence.
  REVOKED is terminal in every mode, matching `check()`'s existing carve-out (`:104`).
- Under `OFF`, `eligible` is still computed truthfully; `blocking` is always false.

**Endpoints**

| Method | Path | Capability | Writes |
| --- | --- | --- | --- |
| `POST` | `/api/facilities` | `MANAGE_CATALOG` | yes |
| `PATCH` | `/api/facilities/:id` | `MANAGE_CATALOG` | yes |
| `GET` | `/api/production/eligibility` | `RUN_PRODUCTION` | **no — asserted by test** |
| `GET` | `/api/compliance/overview` | `VIEW_OPERATIONS` | no |

`POST /api/licenses` — `ApplyForLicenseDto` gains optional `facilityId`.
`GET /api/licenses` — each entry gains `facilityId`, `facilityName`, and explicit
`grain: 'ORGANIZATION' | 'FACILITY'`.
`POST /api/production/orders` — evaluates, stores, links; refuses only when `blocking`, with
the failing checks in the error payload.

**Refusal shape.** `TraceabilityRuleException` maps to **409**, not 400 — verified during the
MVP gate. The frontend must branch on 409 carrying `checks`, not on 400.

---

## 7. Work units

Ten units, in dependency order. Each is **independently testable and independently
revertible, with explicit dependencies** — the dependencies are stated as preconditions and
are binding, not advisory. A unit is not done until its done-conditions all hold, and no
unit begins until every precondition it names is satisfied.

*Not* "independently shippable": several units are only correct in combination. WU-2 in
particular is one unit of work with its migration — a deployment carrying `licenses.facility_id`
without the five query changes is less correct than one carrying neither.

### WU-1 · Facility write endpoints — **IMPLEMENTED 21 Aug 2026, awaiting review**
**Precondition:** none. **Migration:** none.
**Delivered:** `dto/facility.dto.ts`, `services/facility.service.ts`, rewritten
`controllers/facility.controller.ts`, `FacilityService` registered in `app.module.ts`,
`OrganizationService.create` re-pointed at the shared minting path, one guard added to
`ProductionService.resolveFacility`. **348 tests pass** (was 326); build clean; 24 live
checks pass against a running API.

**Two rules were added in the first pass and removed on review.** Neither was in the
contract, so neither shipped: the last open site of an organization *may* be closed, and two
sites of one organization *may* share a name. The service does not police either.

**The gap that motivated the first of them is closed at the right layer instead.**
`ProductionService.resolveFacility` used to return `null` whenever a business had no open
site, which is correct for a shop that never had a plant and wrong for a manufacturer that
closed all of theirs — the second case would have produced unsited batches and DR-02 would
have stopped being true silently. It now distinguishes them: no facilities at all still
returns `null`; facilities that exist but are all closed raises
`TraceabilityRuleException` naming the reason. Verified live (409, *"has no site in
operation — reopen one before producing"*).

**One numbering path.** `OrganizationService.create` no longer draws its own `FAC-` number;
it calls `FacilityService.openWithin(manager, …)` inside the transaction it already holds.
Verified live: a business's onboarding site and its next site take **consecutive** codes.
Eight onboarding regression tests cover site creation, naming, transaction, user attachment,
provisional licence, and the two refusal paths.

#### API compatibility change — multi-site `facilityId`

`POST /api/production-orders` gains a **conditionally required** field.

| Organization state | `facilityId` | Behaviour |
| --- | --- | --- |
| One open site | optional | Unchanged — the site is inferred |
| Two or more open sites | **required** | 409 `"<org> operates N sites — say which one is producing this"` |
| Sites exist, all closed | n/a | 409 `"<org> has no site in operation"` — **new**, previously produced an unsited batch |
| Never had a site | optional | Unchanged — `null`, a shop is not forced to invent a plant |

No organization is affected until it opens a second site, which is a deliberate act. From
that moment every integration raising production orders for that organization must send
`facilityId` or start receiving 409s. This is intended under DR-02 — a guess would put a
recall at the wrong plant — but it is a client-visible contract change and should be
announced rather than discovered. It needs no migration and no version bump; it takes effect
per-organization, on the day that organization adds a site.
**Files:** `src/organization/controllers/facility.controller.ts`, new
`src/organization/dto/facility.dto.ts`, `facility.service.ts`.
**Contract:** `POST` creates a site with a `FAC-` code from the shared sequence, inside a
transaction (the sequence takes a pessimistic lock — this is the failure mode that broke
organization creation during DR-02). `PATCH` renames, re-addresses, and deactivates.
**Done when:** an organization can hold a second site; deactivating a site leaves its
licences dormant, not lapsed (OQ 10); no cross-organization read or write is possible.
**Tests:** create second site · code uniqueness under concurrent creation · deactivate with
an active licence attached · another organization's site is 404, not 403.
**Revert:** delete the routes. No data shape changes.

*Why first: 211 organizations, 211 facilities, zero with a second site. The Inyange scenario
is not unauthorised today — it is unenterable, and every unit below is untestable without
this one.*

### WU-2 · M1 + the five query changes — **IMPLEMENTED 21 Aug 2026, awaiting review**
**Precondition:** **D1 signed**, WU-1 merged. **Migration:** M1.
**Delivered:** new `src/licensing/governing-licence.ts` (the single resolver), `licenses.facility_id`
via migration `1757800000000-LicenseFacility`, entity relation, all five query changes,
`grain` on licence responses, two new spec files. **375 tests pass** (was 348); build clean;
migration applies and reverts cleanly; 16 HTTP checks and 15 database-level checks pass.
**Deviations from the contract, both reported:** the write-side guard for invariant 1 lands
in WU-3 (WU-2 introduces no path that sets `facility_id`), so invariant 1 is proved by a
database assertion and by the resolver refusing to rely on a mis-scoped row, not by a
service guard; and `apply()`'s facility predicate is fixed at `IS NULL` because the DTO
field is WU-3's.
**Files:** `license.entity.ts`, `license.service.ts` (`apply`, `issueProvisional`,
`effectiveLicense`, `listFor`), `license-enforcement.service.ts` (`assess`), M1 migration.
**Contract:** D1 implemented in exactly one resolver, shared by `assess()` and
`effectiveLicense()` (**T2**). Licence responses carry `grain`.
**Done when:** DR §24 invariants 1, 3, 4, 5 hold as tests; one implementation of
governing-licence resolution exists; `mayReceive()` is re-pointed.
**Tests:** site licence does not authorise a sibling site · suspending Huye's licence leaves
Kigali passing · org may apply for Huye while holding Kigali's · provisional grace is not
suppressed by a site licence · a licence referencing another org's facility is refused.
**Revert:** M1 `down()` + revert the five queries. Single unit both ways.

### WU-3 · `ApplyForLicenseDto.facilityId` and grain in `describe()` — **IMPLEMENTED 21 Aug 2026, awaiting review**
**Delivered:** optional `facilityId` on `ApplyForLicenseDto`; `LicenseService.resolveFacility`
(the single write path to `licenses.facility_id`, and where invariant 1 is now enforced);
`renew()` carries the grain forward; 13 tests in `facility-licence.spec.ts`. **387 tests
pass** (was 375); build clean; 24 live checks pass, including apply → attach → submit →
review → approve → renew against a facility through the existing regulator queue.
**Two defects found and fixed during the unit**, both described below: a renewal silently
changed grain, and a created licence could not name its own site.
**No migration** — M1 already supplied the column.
**Bounded by OQ 1 as decided:** no jurisdiction model, no queue filtering, no new regulator
capability, no change to `decide`/`suspend`/`revoke` authorization. The queue is untouched.

**Precondition:** WU-2 merged · **OQ 1 answered ☑ 21 Aug 2026 — accepted for MVP, existing
queue and existing regulator rules (§9)** · OQ 4 answered (default: same `MFG` category rows).
**Bounded by OQ 1's decision:** WU-3 introduces no jurisdiction model, no queue filtering,
no new regulator capability, and no change to `decide`/`suspend`/`revoke` authorization.
**Contract:** the write path for site licences; `describe()` reports grain.
**Done when:** a facility licence can be applied for, reviewed and decided through the
existing regulator flow with no new endpoint.
**Tests:** apply → submit → review → decide against a facility, asserting one `LicenseEvent`
per decision (DR §24 invariant 18).

### WU-4 · `ProductionEligibilityService`
**Precondition:** **D2 signed**, WU-3 merged, OQ 5 and OQ 12 answered.
**Migration:** none — this unit computes, it does not store.
**Files:** new `src/licensing/services/production-eligibility.service.ts`, new
`src/licensing/eligibility.ts`, `app.module.ts`.
**Contract:** §6 exactly. Six live checks, two inert. Depends on `assess()`, never on
`check()` (**T1**). Writes nothing. Wires `permittedProductCategories` to
`PRODUCT_CATEGORY_COVERAGE` — no schema change; the field has been waiting since the
licensing migration and has never had a reader.
**Done when:** DR §24 invariants 7, 8, 10, 12, 13 hold as tests; the service writes no row in
any code path.
**Tests:** all eight checks returned when the first fails (no short-circuit) · `blocking`
truth table across OFF/ADVISORY/STRICT × eligible/ineligible × REVOKED · provisional → WARN
per D2 · empty `permittedProductCategories` per OQ 5 · absent `categoryId` per OQ 12 ·
licence valid today but expired on `requestedDate` → FAIL · architecture test: nothing
outside `src/licensing/` imports `License`, `LicenseCategory` or `LicenseStatus`.

### WU-5 · `GET /api/production/eligibility`
**Precondition:** WU-4. **Contract:** pure read; renders `checks`, never re-derives a verdict.
**Done when:** DR §24 invariant 11 holds as an integration test comparing
`compliance_findings` and notification row counts before and after 50 calls (**T1**).

### WU-6 · M2 + eligibility at production-order creation
**Precondition:** WU-5, OQ 2 answered (default: global mode governs). **Migration:** M2.
**Files:** `manufacturing/services/production.service.ts` (`create()`, currently has **no
licensing check at all** — the enforcement hole this DR closes), new entity, M2 migration.
**Contract:** evaluate server-side, insert the decision, link it, refuse only when
`blocking`; under ADVISORY an ineligible run creates the order and writes exactly one
`ComplianceFinding`.
**Done when:** DR §24 invariants 6, 9, 15 hold as tests.
**Tests:** every new order references exactly one decision whose org/facility/product match ·
ADVISORY ineligible → order created + one finding + notification · STRICT ineligible → 409
carrying the failing checks · REVOKED → refused in all modes · stored `checks` identical to
the returned ones · no `UPDATE`/`DELETE` against the table anywhere in the tree.
**Revert:** M2 `down()`. Orders keep working; they simply stop being justified.

### WU-7 · `GET /api/compliance/overview`
**Precondition:** WU-4. Org status + per-facility + per-product, provisional labelled as
provisional. Pure read.

### WU-8 · Frontend — Compliance → Overview and Facilities
**Precondition:** WU-7. Renders server-computed status only; the browser never recomputes
eligibility, for the same reason it does not recompute capabilities.

### WU-9 · Frontend — Start Production wizard
**Precondition:** WU-5, WU-6. Product · facility · quantity · date → live check list →
`READY TO PRODUCE` or `CANNOT PRODUCE` with the failing check and its remedy link.
**Done when:** a blocked run never shows a bare 403 or 409; the reason and the next action
are both on screen.

### WU-10 · Retire the duplicated activity helper
`activityForType()` (`license.service.ts:776`) and `requiredActivityFor()`
(`license-enforcement.service.ts:174`) are the same function. Cleanup only; no behaviour
change. Independent of every unit above.

---

## 8. Invariant → verification map

DR §24's 22 invariants, each bound to the unit that must prove it.

| Invariant | Unit | How it is proved |
| --- | --- | --- |
| 1, 2 licence never references another org's facility/product | WU-2 | integration test + service guard |
| 3, 4, 5 facility scoping and replacement | WU-2 | unit tests on the resolver |
| 6 every order references exactly one matching decision | WU-6 | integration test |
| 7 never short-circuits | WU-4 | unit test asserting `checks.length === 8` on first failure |
| 8 `blocking` truth table | WU-4 | parameterised unit test, 12 cases |
| 9 exactly one finding under ADVISORY | WU-6 | integration test, row count |
| 10 no licensing entity imported outside `src/licensing/` | WU-4 | architecture test, runs in CI |
| 11 preview writes nothing | WU-5 | integration test, row counts before/after |
| 12, 13 provisional never passes product authorization; WARNs not FAILs | WU-4 | unit tests, per D2 |
| 14 no provisional ever mutated | standing | repo-wide grep test, already effectively true |
| 15, 16 decisions append-only; history read not recomputed | WU-6 | grep test + integration test |
| 17, 18 licence events append-only, one per decision | WU-3 | existing tests extended |
| 19, 20 taxonomy carries no authority | standing | schema test — passes today, must keep passing |
| 21 protected core untouched | standing | the DR-01/02 conformance walkthroughs, unchanged |
| 22 `ProductionOrderStatus` gains no regulatory member | standing | enum snapshot test |

---

## 9. Stop condition — resolved for MVP, open for production

**Regulator jurisdiction is out of scope and stays out.** `queue()`
(`license.service.ts:241`) hands every pending application on the platform to any of the five
REGULATOR organizations, including applicants' uploaded certificates, and
`decide`/`suspend`/`revoke` gate on organization type alone.

Fixing it is a change to regulator visibility — an explicit stop condition — so no
implementation path is proposed here, and none may be improvised during implementation.

**But open question 1 is now a hard prerequisite for WU-3, not a recommendation.** WU-3
widens what that unscoped queue exposes: facility-level applications join a list every
regulator can already read in full, certificates included. Shipping WU-3 against an unscoped
queue would be a deliberate decision to broaden an already-broad exposure, and that decision
is not one implementation gets to make silently.

### OQ 1 — DECIDED 21 Aug 2026: accepted for MVP

Facility-scoped licence applications use the existing regulator queue. Any authorised
`REGULATOR` organization may view and decide a pending application regardless of whose
jurisdiction the facility falls in.

**Accepted consequence, recorded so it is not later mistaken for a design:** a
facility-specific application may be visible to regulator organizations that are not
responsible for that facility's jurisdiction. This is an explicit MVP limitation and must
never be presented as SanTrack's regulatory operating model.

**Why:** scoping the queue would require a jurisdiction model, authority scope, queue
filtering, permission changes and possibly new domain entities — outside the approved DR-07
MVP scope, and it would delay the facility → licence → eligibility → production flow the
MVP exists to demonstrate.

**What this authorises:** WU-3, proceeding on the existing queue and the existing regulator
authorization rules.

**What it does not authorise**, and what no part of WU-3 may quietly introduce: a
jurisdiction model · `RegulatoryAuthority` · jurisdiction-based queue filtering · new
regulator capabilities · any change to existing regulator organization permissions · any
change to `decide`, `suspend` or `revoke` authorization beyond what WU-3 itself requires.

**Post-MVP requirement, carried forward:** before SanTrack is deployed as a production
regulatory system, regulator visibility and decision authority must be scoped by
jurisdiction or authority. That work needs its own decision record and its own
implementation contract. OQ 1 is closed for the MVP and remains open as an architectural
requirement.

---

## 10. Regression surface

These must still pass, unchanged, at every unit boundary: the 326-test suite · the three
conformance walkthroughs (traceability, production-lifecycle, commerce-fulfilment) · all
three traceability levels end to end (SERIAL 100→100, PACKAGE 9,600@24→400, BATCH 10,000→1) ·
the identity cap · the facility invariant (every org has at least one site, no orphans) ·
provisional coexistence with a full application · free-text category refusal on create and
update.

Known and unchanged: PACKAGE registration of 400 identities takes ~100s. Not touched by this
work, still worth scheduling.

---

## 11. Explicit non-goals

This contract does not authorise: changing what a provisional licence permits · converting
provisional licences · changing enforcement mode defaults · scoping the regulator queue ·
creating any deferred entity · touching `TraceabilityEvent`, `TraceableItem`, the packaging
hierarchy, permanent identity or the batch lifecycle · dropping `Product.category` · dropping
`permittedProductCategories`.

---

## 12. Sign-off

| Gate | Status | Decision |
| --- | --- | --- |
| D1 facility replacement rule | ☑ 21 Aug 2026 | Replacement, not additive |
| D2 provisional under eligibility | ☑ 21 Aug 2026 | `WARN`, not `FAIL`, not silent |
| OQ 5 category-coverage default | ☑ 21 Aug 2026 | Empty stays unrestricted → `PASS` |
| OQ 12 uncategorised products | ☑ 21 Aug 2026 | `WARN` |
| OQ 2 production enforcement mode | ☑ 21 Aug 2026 | Global mode governs |
| OQ 4 facility licence categories | ☐ | Default stands (same `MFG` rows); revisit at WU-3 |
| OQ 1 regulator jurisdiction | ☑ 21 Aug 2026 | Accepted for MVP — existing queue, existing rules (§9). Post-MVP requirement carried forward |

Every gate blocking WU-1 through WU-6 is now signed.

**Progress:** WU-1 authorised, implemented, revised on review, **approved 21 Aug 2026**.
WU-2 implemented 21 Aug 2026, **awaiting review**. WU-3 is unblocked on OQ 1 and waits only
on WU-2's review, which its own precondition requires.

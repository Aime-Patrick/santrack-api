import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BatchStatus } from '../../batch/batch-status.enum';
import { Batch } from '../../batch/entities/batch.entity';
import { today } from '../../item/entities/traceable-item.entity';
import { Product } from '../../product/entities/product.entity';
import { TraceabilityLevel } from '../../product/traceability-level.enum';
import { License } from '../entities/license.entity';
import {
  EligibilityCheck,
  EligibilityCheckCode,
  EligibilityResult,
  RULESET_VERSION,
  isEligible,
} from '../eligibility';
import { Assessment } from '../governing-licence';
import {
  EnforcementMode,
  LicensedActivity,
  LicenseVerdict,
} from '../licensing.enums';
import { LicenseEnforcementService } from './license-enforcement.service';

/** What a caller wants to know before it starts making something. */
export interface EligibilityQuestion {
  organizationId: number;
  facilityId?: number | null;
  productId: number;
  requestedQuantity: number;
  /** yyyy-MM-dd. The date the run is *for*, which need not be today. */
  requestedDate?: string | null;
}

/**
 * Whether a business may make a given product, at a given site, on a given day.
 *
 * This service answers; it never acts. It writes no row to any table in any
 * code path — no finding, no notification, no decision (DR §24 invariant 11).
 * That is not tidiness, it is the whole design: `GET /api/production/eligibility`
 * is a preview the Start Production screen calls on every field change, and a
 * verdict that wrote something would file a compliance finding and notify the
 * licence holder once per keystroke.
 *
 * For the same reason it depends on {@link LicenseEnforcementService.assess}
 * and never on `check()` (DR-07 contract §3, trap T1). `check()` is unusable
 * here for three independent reasons: under `OFF` it fabricates a `LICENSED`
 * verdict without assessing anything, so `eligible` would be a lie in one of
 * the three modes; it throws on REVOKED and under STRICT, and a complete check
 * list cannot be assembled from a function that terminates the request halfway
 * through it; and it writes before it refuses.
 *
 * The check list is always complete and always in order, even when the first
 * entry fails (invariant 7). Somebody who has been stopped needs to see
 * everything that is wrong with the run, not the first thing noticed.
 */
@Injectable()
export class ProductionEligibilityService {
  constructor(
    private readonly enforcement: LicenseEnforcementService,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
  ) {}

  async evaluate(question: EligibilityQuestion): Promise<EligibilityResult> {
    const facilityId = question.facilityId ?? null;
    const requestedDate = question.requestedDate ?? today();
    const activity = LicensedActivity.MANUFACTURING;

    /**
     * Two assessments, not one, and both through the single resolver.
     *
     * The first asks about the business — "is this company licensed to
     * manufacture at all?" — and only organization-grained licences answer it.
     * The second asks about the site, which brings the replacement rule (D1)
     * into play: where the site holds its own licence, that licence and not the
     * company's decides, for better and for worse.
     */
    const organization = await this.enforcement.assess(
      question.organizationId,
      activity,
      null,
    );
    const site = await this.enforcement.assess(
      question.organizationId,
      activity,
      facilityId,
    );

    const product = await this.products.findOne({
      where: { id: question.productId, organizationId: question.organizationId },
    });

    const governing = site.license;

    const checks: EligibilityCheck[] = [
      this.organizationLicence(organization),
      this.facilityAuthorization(site, facilityId),
      this.categoryCoverage(governing, product),
      {
        code: EligibilityCheckCode.PRODUCT_AUTHORIZATION,
        status: 'NOT_APPLICABLE',
        message:
          'Individual products do not carry their own authorisation on this platform yet.',
      },
      this.validityAtRequestedDate(governing, requestedDate),
      this.traceability(product, question.productId),
      await this.batchAndRecall(product),
      {
        code: EligibilityCheckCode.PER_PRODUCTION_APPROVAL,
        status: 'NOT_APPLICABLE',
        message: 'No approval is required for an individual production run.',
      },
    ];

    const eligible = isEligible(checks);
    const mode = this.enforcement.enforcementMode();

    /**
     * Revocation is terminal in every mode, OFF included, matching the carve-out
     * `check()` has always had and DR §24 invariant 8, which states the rule as
     * a biconditional with no exception for a mode. Everything else defers to
     * the configured mode: the platform supervises by default and gatekeeps only
     * where it is told to (OQ 2 — global mode governs).
     *
     * The contract also says "under OFF, `blocking` is always false". Read
     * absolutely, the two sentences contradict each other; read as scoping the
     * mode-driven clause — OFF adds no blocking of its own — they agree, and
     * that is the reading taken here. Revoking a licence exists to make a
     * business stop, and a deployment setting is not a reason for it not to.
     */
    const revoked =
      failedOn(checks, EligibilityCheckCode.ORGANIZATION_LICENCE, organization) ||
      failedOn(checks, EligibilityCheckCode.FACILITY_AUTHORIZATION, site);

    const blocking = revoked || (!eligible && mode === EnforcementMode.STRICT);

    return {
      eligible,
      blocking,
      enforcementMode: reportedMode(mode),
      evaluatedAt: new Date(),
      checks,
      reliedOn: reliedOn([organization.license, site.license]),
      rulesetVersion: RULESET_VERSION,
    };
  }

  // ----------------------------------------------------------------- checks

  /**
   * Does the business hold a manufacturing licence at all?
   *
   * A provisional licence inside its dates returns WARN, never FAIL (D2, DR §24
   * invariant 13). 180 of 182 licences on the platform are grace records, so
   * failing them would stop almost everything that produces today. The
   * distinction becomes visible without becoming enforcing.
   */
  private organizationLicence(assessment: Assessment): EligibilityCheck {
    const code = EligibilityCheckCode.ORGANIZATION_LICENCE;
    const licence = assessment.license;
    const licences = { label: 'Go to licences', href: '/licenses' };

    switch (assessment.verdict) {
      case LicenseVerdict.LICENSED:
        if (licence?.provisional) {
          return {
            code,
            status: 'WARN',
            message:
              `Trading on provisional licence ${licence.licenseNumber}, which was ` +
              'issued automatically at registration rather than by a regulator' +
              (licence.expiresOn ? ` and expires ${licence.expiresOn}` : '') +
              '. Apply for a full manufacturing licence before it lapses.',
            remedy: { label: 'Apply for a full licence', href: '/licenses' },
          };
        }
        return {
          code,
          status: 'PASS',
          message:
            `Manufacturing licence ${licence?.licenseNumber} is active` +
            (licence?.expiresOn ? ` until ${licence.expiresOn}` : '') +
            '.',
        };

      case LicenseVerdict.REVOKED:
        return {
          code,
          status: 'FAIL',
          message:
            `Manufacturing licence ${licence?.licenseNumber} has been revoked` +
            reason(licence) +
            '. Production cannot go ahead in any circumstance.',
          remedy: licences,
        };

      case LicenseVerdict.SUSPENDED:
        return {
          code,
          status: 'FAIL',
          message:
            `Manufacturing licence ${licence?.licenseNumber} is suspended` +
            reason(licence) +
            '. Returns and recalls remain available.',
          remedy: licences,
        };

      case LicenseVerdict.EXPIRED:
        return {
          code,
          status: 'FAIL',
          message:
            `Manufacturing licence ${licence?.licenseNumber} has lapsed` +
            (licence?.expiresOn ? ` (expired ${licence.expiresOn})` : '') +
            '. Renew it before producing.',
          remedy: { label: 'Renew this licence', href: '/licenses' },
        };

      default:
        return {
          code,
          status: 'FAIL',
          message:
            'This business holds no manufacturing licence. Apply for one before ' +
            'starting production.',
          remedy: { label: 'Apply for a licence', href: '/licenses' },
        };
    }
  }

  /**
   * Is *this site* authorised for the run?
   *
   * The licence consulted here is the governing one under D1: the site's own if
   * it holds one in a decided state, otherwise the company's. That replacement
   * is what gives a site suspension any force — without it, suspending one
   * plant would change nothing because the national licence would still pass.
   *
   * Provisional is deliberately not re-flagged here. D2 assigns the warning to
   * `ORGANIZATION_LICENCE`, and saying it twice on the same licence would double
   * a warning that already appears on nearly every run.
   */
  private facilityAuthorization(
    assessment: Assessment,
    facilityId: number | null,
  ): EligibilityCheck {
    const code = EligibilityCheckCode.FACILITY_AUTHORIZATION;
    const licence = assessment.license;
    const site = licence?.facility?.name ?? null;
    const unnamed = facilityId === null;
    const licences = { label: 'Go to licences', href: '/licenses' };

    switch (assessment.verdict) {
      case LicenseVerdict.LICENSED:
        if (site) {
          return {
            code,
            status: 'PASS',
            message: `${site} holds its own licence ${licence?.licenseNumber}, which covers this run.`,
          };
        }
        return {
          code,
          status: 'PASS',
          message: unnamed
            ? `No particular site was named; company licence ${licence?.licenseNumber} covers the run.`
            : `This site is covered by company licence ${licence?.licenseNumber}.`,
        };

      case LicenseVerdict.REVOKED:
        return {
          code,
          status: 'FAIL',
          message:
            `The licence covering this site, ${licence?.licenseNumber}, has been ` +
            `revoked${reason(licence)}.`,
          remedy: licences,
        };

      case LicenseVerdict.SUSPENDED:
        return {
          code,
          status: 'FAIL',
          message: site
            ? `${site} is suspended under licence ${licence?.licenseNumber}${reason(licence)}. ` +
              'Other sites of this business are unaffected.'
            : `The licence covering this site, ${licence?.licenseNumber}, is ` +
              `suspended${reason(licence)}.`,
          remedy: licences,
        };

      case LicenseVerdict.EXPIRED:
        return {
          code,
          status: 'FAIL',
          message: site
            ? `${site}'s own licence ${licence?.licenseNumber} lapsed` +
              (licence?.expiresOn ? ` on ${licence.expiresOn}` : '') +
              '. A site with its own licence no longer relies on the company one, ' +
              'so this site cannot produce until it is renewed.'
            : `The licence covering this site, ${licence?.licenseNumber}, has lapsed` +
              (licence?.expiresOn ? ` (expired ${licence.expiresOn})` : '') +
              '.',
          remedy: { label: 'Renew this licence', href: '/licenses' },
        };

      default:
        return {
          code,
          status: 'FAIL',
          message:
            'No licence authorises manufacturing at this site. Apply for one for ' +
            'the site, or for the business as a whole.',
          remedy: { label: 'Apply for a licence', href: '/licenses' },
        };
    }
  }

  /**
   * Does the governing licence cover this kind of goods?
   *
   * Empty `permittedProductCategories` means unrestricted, and stays meaning
   * that (OQ 5). Every `LicenseCategory` on the platform holds an empty list and
   * this check is the field's first ever reader, so whatever "empty" is made to
   * mean applies to 100% of licences on the first day. Empty already means
   * unrestricted for warehousing and distribution; changing it here would be a
   * policy change wearing a bug fix's clothes.
   *
   * The empty case is settled before the product is looked at, deliberately: a
   * licence that restricts nothing has nothing to say about how a product is
   * classified, and warning about an unclassified product against a licence
   * that does not care would put a second warning on every run on the platform.
   *
   * A product with no category is a catalogue gap, not a regulatory breach, so
   * it warns and never fails (OQ 12) — 92 of 111 products carry no category.
   */
  private categoryCoverage(
    governing: License | null,
    product: Product | null,
  ): EligibilityCheck {
    const code = EligibilityCheckCode.PRODUCT_CATEGORY_COVERAGE;

    if (!governing) {
      return {
        code,
        status: 'NOT_APPLICABLE',
        message:
          'No licence governs this run, so there is nothing to check the product ' +
          'against.',
      };
    }

    const permitted = governing.category?.permittedProductCategories ?? [];
    if (permitted.length === 0) {
      return {
        code,
        status: 'PASS',
        message:
          `Licence ${governing.licenseNumber} is not restricted to particular ` +
          'product categories.',
      };
    }

    if (!product) {
      return {
        code,
        status: 'NOT_APPLICABLE',
        message: 'The product could not be found, so its category cannot be checked.',
      };
    }

    const productCategory = product.productCategory;
    if (!productCategory) {
      return {
        code,
        status: 'WARN',
        message:
          `${product.name} has no product category recorded, so it cannot be matched ` +
          `against the ${permitted.length} categories licence ${governing.licenseNumber} ` +
          'covers. Classify it so the licence can be checked properly.',
        remedy: { label: 'Classify this product', href: `/products/${product.id}` },
      };
    }

    if (permitted.includes(productCategory.code)) {
      return {
        code,
        status: 'PASS',
        message:
          `${productCategory.name} is covered by licence ${governing.licenseNumber}.`,
      };
    }

    return {
      code,
      status: 'FAIL',
      message:
        `Licence ${governing.licenseNumber} does not cover ${productCategory.name}. ` +
        `It covers: ${permitted.join(', ')}.`,
      remedy: { label: 'Go to licences', href: '/licenses' },
    };
  }

  /**
   * Is the governing licence in force on the day the run is *for*?
   *
   * Against `requestedDate`, not today. That is what catches the case a
   * manufacturer most needs warning about — a licence that is perfectly valid
   * this morning and expires before the run they are scheduling — and it is
   * also what makes a backdated run honest: a run recorded for a date the
   * licence did not cover is ineligible, and under ADVISORY it is permitted
   * with a finding rather than quietly accepted (OQ 11).
   */
  private validityAtRequestedDate(
    governing: License | null,
    requestedDate: string,
  ): EligibilityCheck {
    const code = EligibilityCheckCode.LICENCE_VALIDITY_AT_REQUESTED_DATE;

    if (!governing) {
      return {
        code,
        status: 'NOT_APPLICABLE',
        message: 'There is no licence whose dates could be checked against this run.',
      };
    }

    if (governing.isWithinDates(requestedDate)) {
      return {
        code,
        status: 'PASS',
        message:
          `Licence ${governing.licenseNumber} is within its dates on ${requestedDate}.`,
      };
    }

    if (governing.issuedOn && requestedDate < governing.issuedOn) {
      return {
        code,
        status: 'FAIL',
        message:
          `Licence ${governing.licenseNumber} was not issued until ${governing.issuedOn}, ` +
          `so it did not cover production on ${requestedDate}.`,
        remedy: { label: 'Go to licences', href: '/licenses' },
      };
    }

    return {
      code,
      status: 'FAIL',
      message:
        `Licence ${governing.licenseNumber} expires on ${governing.expiresOn}, before ` +
        `the requested production date of ${requestedDate}. Renew it, or bring the run ` +
        'forward.',
      remedy: { label: 'Renew this licence', href: '/licenses' },
    };
  }

  /**
   * Can the finished goods be traced at the level the catalogue says they must
   * be (DR-01)?
   *
   * Every level SanTrack supports is satisfiable today, so this passes for any
   * product that exists. It is in the list because the level is the thing a
   * future regulatory minimum would be compared against, and a check that
   * appears later changes the response shape.
   */
  private traceability(product: Product | null, productId: number): EligibilityCheck {
    const code = EligibilityCheckCode.PRODUCT_TRACEABILITY;

    if (!product) {
      return {
        code,
        status: 'FAIL',
        message: `No product ${productId} is in this business's catalogue.`,
        remedy: { label: 'Open the catalogue', href: '/products' },
      };
    }

    const known = Object.values(TraceabilityLevel) as string[];
    if (!product.traceabilityLevel || !known.includes(product.traceabilityLevel)) {
      return {
        code,
        status: 'WARN',
        message:
          `${product.name} has no recognised traceability level recorded, so how ` +
          'finely this run will be traced is unclear.',
        remedy: { label: 'Open the product', href: `/products/${product.id}` },
      };
    }

    return {
      code,
      status: 'PASS',
      message: `${product.name} is traced at ${product.traceabilityLevel} level.`,
    };
  }

  /**
   * Is anything already made of this product under a recall or being held?
   *
   * Read from the batch lifecycle as it stands rather than from new recall
   * semantics: `RECALLED` is what `RecallService` sets and lists, and
   * `QUARANTINED` is the only "held pending a decision" state the enum has.
   * Making more of a product whose existing lots are being withdrawn is exactly
   * the moment somebody should be asked whether they mean to.
   */
  private async batchAndRecall(product: Product | null): Promise<EligibilityCheck> {
    const code = EligibilityCheckCode.BATCH_AND_RECALL_RESTRICTIONS;

    if (!product) {
      return {
        code,
        status: 'NOT_APPLICABLE',
        message: 'There is no product whose lots could be checked.',
      };
    }

    const held = await this.batches.find({
      where: {
        product: { id: product.id },
        status: In([BatchStatus.RECALLED, BatchStatus.QUARANTINED]),
      },
      order: { id: 'DESC' },
      take: 20,
    });

    const recalled = held.filter((batch) => batch.status === BatchStatus.RECALLED);
    if (recalled.length > 0) {
      return {
        code,
        status: 'FAIL',
        message:
          `${recalled.length} lot${recalled.length === 1 ? '' : 's'} of ${product.name} ` +
          `${recalled.length === 1 ? 'is' : 'are'} under recall ` +
          `(${recalled.map((batch) => batch.batchCode).slice(0, 3).join(', ')}). ` +
          'Close the recall before making more.',
        remedy: { label: 'Review the recall', href: '/recalls' },
      };
    }

    const quarantined = held.filter(
      (batch) => batch.status === BatchStatus.QUARANTINED,
    );
    if (quarantined.length > 0) {
      return {
        code,
        status: 'FAIL',
        message:
          `${quarantined.length} lot${quarantined.length === 1 ? '' : 's'} of ` +
          `${product.name} ${quarantined.length === 1 ? 'is' : 'are'} quarantined ` +
          `(${quarantined.map((batch) => batch.batchCode).slice(0, 3).join(', ')}). ` +
          'Resolve the quality decision before making more.',
        remedy: { label: 'Open the batches', href: '/batches' },
      };
    }

    return {
      code,
      status: 'PASS',
      message: `No lot of ${product.name} is under recall or quarantine.`,
    };
  }
}

/** Whether a named check failed on a licence a regulator has revoked. */
function failedOn(
  checks: EligibilityCheck[],
  code: EligibilityCheckCode,
  assessment: Assessment,
): boolean {
  const check = checks.find((entry) => entry.code === code);
  return check?.status === 'FAIL' && assessment.verdict === LicenseVerdict.REVOKED;
}

/**
 * What the decision was taken on the strength of.
 *
 * Ids, numbers and category codes together, because ids alone stop being an
 * audit record the moment a `LicenseCategory` is deactivated: a decision that
 * can no longer name what it relied on has not recorded anything.
 */
function reliedOn(licences: (License | null)[]): {
  licenseIds: number[];
  licenseNumbers: string[];
  categoryCodes: string[];
} {
  const present = licences.filter((licence): licence is License => !!licence);
  return {
    licenseIds: unique(present.map((licence) => licence.id)),
    licenseNumbers: unique(present.map((licence) => licence.licenseNumber)),
    categoryCodes: unique(
      present
        .map((licence) => licence.category?.code)
        .filter((code): code is string => !!code),
    ),
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Why a licence is in the state it is in, where the regulator said. */
function reason(licence: License | null): string {
  return licence?.statusReason ? ` — ${licence.statusReason}` : '';
}

/**
 * The mode as the frozen response reports it. The enum's own values are lower
 * case because they come from configuration; the API contract is upper case.
 */
function reportedMode(mode: EnforcementMode): 'OFF' | 'ADVISORY' | 'STRICT' {
  switch (mode) {
    case EnforcementMode.OFF:
      return 'OFF';
    case EnforcementMode.STRICT:
      return 'STRICT';
    default:
      return 'ADVISORY';
  }
}

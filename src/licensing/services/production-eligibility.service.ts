import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BatchStatus } from '../../batch/batch-status.enum';
import { Batch } from '../../batch/entities/batch.entity';
import { today } from '../../item/entities/traceable-item.entity';
import { Product } from '../../product/entities/product.entity';
import { TraceabilityLevel } from '../../product/traceability-level.enum';
import {
  ProductRegistration,
  ProductRegistrationStatus,
} from '../../product/entities/product-registration.entity';
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
    @InjectRepository(ProductRegistration)
    private readonly productRegistrations: Repository<ProductRegistration>,
  ) {}

  async evaluate(question: EligibilityQuestion): Promise<EligibilityResult> {
    const facilityId = question.facilityId ?? null;
    const requestedDate = question.requestedDate ?? today();
    const activity = LicensedActivity.MANUFACTURING;
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
      await this.productAuthorization(product, question.organizationId, requestedDate),
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
  private async productAuthorization(
    product: Product | null,
    organizationId: number,
    requestedDate: string,
  ): Promise<EligibilityCheck> {
    const code = EligibilityCheckCode.PRODUCT_AUTHORIZATION;
    const applyLink = { label: 'Apply for product registration', href: '/dashboard/products' };

    if (!product) {
      return {
        code,
        status: 'NOT_APPLICABLE',
        message: 'No product was found, so its registration cannot be checked.',
      };
    }

    const registrations = await this.productRegistrations.find({
      where: {
        productId: product.id,
        organizationId,
        status: In([
          ProductRegistrationStatus.APPROVED,
          ProductRegistrationStatus.SUSPENDED,
        ]),
      },
      order: { updatedAt: 'DESC' },
      take: 10,
    });

    const approved = registrations.find(
      (r) =>
        r.status === ProductRegistrationStatus.APPROVED &&
        (!r.expiresOn || r.expiresOn >= requestedDate),
    );

    if (approved) {
      return {
        code,
        status: 'PASS',
        message:
          `Product registration ${approved.registrationNumber} is active` +
          (approved.expiresOn ? ` until ${approved.expiresOn}` : '') +
          '.',
      };
    }

    // An approved registration that has lapsed by the requested date.
    const lapsed = registrations.find(
      (r) =>
        r.status === ProductRegistrationStatus.APPROVED &&
        r.expiresOn &&
        r.expiresOn < requestedDate,
    );
    if (lapsed) {
      return {
        code,
        status: 'FAIL',
        message:
          `Product registration ${lapsed.registrationNumber} expired on ` +
          `${lapsed.expiresOn}. Renew it before producing this product.`,
        remedy: { label: 'Renew registration', href: '/dashboard/products' },
      };
    }

    // Suspended registration — production is paused, not permanently forbidden.
    const suspended = registrations.find(
      (r) => r.status === ProductRegistrationStatus.SUSPENDED,
    );
    if (suspended) {
      return {
        code,
        status: 'WARN',
        message:
          `Product registration ${suspended.registrationNumber} is currently ` +
          'suspended. Contact the issuing authority before proceeding.',
        remedy: applyLink,
      };
    }

    // No approved or suspended registration at all.
    return {
      code,
      status: 'FAIL',
      message:
        `${product.name} has no approved product registration. ` +
        'Apply for a Product Registration / Marketing Authorisation before ' +
        'starting production.',
      remedy: applyLink,
    };
  }
}

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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { License } from '../entities/license.entity';
import {
  Assessment,
  grainOf,
  resolveGoverning,
} from '../governing-licence';
import {
  EnforcementMode,
  LicensedActivity,
  LicenseStatus,
  LicenseVerdict,
} from '../licensing.enums';
import { LicenseEnforcementService } from './license-enforcement.service';

/** How a licence is summarised wherever the overview mentions one. */
export interface LicenceSummary {
  id: number;
  licenseNumber: string;
  status: LicenseStatus;
  verdict: LicenseVerdict;
  grain: 'ORGANIZATION' | 'FACILITY';
  provisional: boolean;
  issuedOn: string | null;
  expiresOn: string | null;
}

export interface ComplianceOverview {
  organization: {
    id: number;
    name: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    message: string;
    licence: LicenceSummary | null;
  };
  facilities: {
    id: number;
    name: string;
    code: string | null;
    active: boolean;
    status: 'PASS' | 'WARN' | 'FAIL';
    message: string;
    licence: LicenceSummary | null;
    inherited: boolean;
  }[];
  products: {
    id: number;
    name: string;
    sku: string;
    status: 'PASS' | 'WARN';
    message: string;
    categoryCode: string | null;
  }[];
  enforcementMode: 'OFF' | 'ADVISORY' | 'STRICT';
  evaluatedAt: Date;
}

/**
 * Where a business stands: the company, each of its sites, each of its products
 * (DR-07 WU-7).
 *
 * Every field here is decided by the server. The browser renders them and
 * derives nothing — no licence validity, no authorization state, no
 * eligibility — for the same reason it does not recompute capabilities: a
 * regulatory rule implemented twice is a regulatory rule that will eventually
 * give two answers.
 *
 * A site's verdict comes from `resolveGoverning`, the same resolver production
 * eligibility uses, never a second reading of the same facts. `inherited` is
 * what lets the screen say *"covered by the company licence"* rather than
 * implying the site holds one of its own — which matters because the moment it
 * does hold one, it stops inheriting (D1).
 *
 * Pure read. Nothing here writes.
 */
@Injectable()
export class ComplianceOverviewService {
  constructor(
    @InjectRepository(License)
    private readonly licenses: Repository<License>,
    @InjectRepository(Facility)
    private readonly facilities: Repository<Facility>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly enforcement: LicenseEnforcementService,
  ) {}

  async of(organization: Organization): Promise<ComplianceOverview> {
    /**
     * The activity this business's own type has to be licensed for. A warehouse
     * is judged on warehousing, not on manufacturing — asking every business
     * about production would put a red mark on every shop on the platform.
     */
    const activity = this.enforcement.requiredActivityFor(organization.type);

    const company = activity
      ? await resolveGoverning(this.licenses, organization.id, activity, null)
      : ({ verdict: LicenseVerdict.LICENSED, license: null } as Assessment);

    const sites = await this.facilities.find({
      where: { organizationId: organization.id },
      order: { id: 'ASC' },
    });

    const facilities = [];
    for (const site of sites) {
      const governing = activity
        ? await resolveGoverning(this.licenses, organization.id, activity, site.id)
        : ({ verdict: LicenseVerdict.LICENSED, license: null } as Assessment);

      const inherited =
        !!governing.license && grainOf(governing.license) === 'ORGANIZATION';

      facilities.push({
        id: site.id,
        name: site.name,
        code: site.code,
        active: site.active,
        status: verdictStatus(governing),
        message: siteMessage(site, governing, inherited, activity),
        licence: summarise(governing),
        inherited,
      });
    }

    const catalogue = await this.products.find({
      where: { organizationId: organization.id },
      order: { id: 'ASC' },
    });

    /**
     * The categories the company's licence restricts itself to. Empty means
     * unrestricted, which is what it has always meant and what every
     * `LicenseCategory` row on the platform currently says (OQ 5).
     */
    const permitted = company.license?.category?.permittedProductCategories ?? [];

    const products = catalogue.map((product) => {
      const code = product.productCategory?.code ?? null;

      if (!code) {
        return {
          id: product.id,
          name: product.name,
          sku: product.sku,
          status: 'WARN' as const,
          message:
            'No product category is recorded, so this cannot be matched against ' +
            'what a licence covers. It is a catalogue gap, not a breach.',
          categoryCode: null,
        };
      }

      if (permitted.length > 0 && !permitted.includes(code)) {
        return {
          id: product.id,
          name: product.name,
          sku: product.sku,
          status: 'WARN' as const,
          message:
            `${product.productCategory?.name ?? code} is outside what licence ` +
            `${company.license?.licenseNumber} lists. Producing it will be flagged.`,
          categoryCode: code,
        };
      }

      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        status: 'PASS' as const,
        message:
          permitted.length === 0
            ? 'Covered — the licence is not restricted to particular categories.'
            : `Covered by licence ${company.license?.licenseNumber}.`,
        categoryCode: code,
      };
    });

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        status: verdictStatus(company),
        message: companyMessage(organization, company, activity),
        licence: summarise(company),
      },
      facilities,
      products,
      enforcementMode: reportedMode(this.enforcement.enforcementMode()),
      evaluatedAt: new Date(),
    };
  }
}

/**
 * A verdict as the three-way status the screen shows.
 *
 * Provisional reads WARN and never PASS (D2): 180 of 182 licences on the
 * platform are grace records issued automatically at registration, and a
 * dashboard that shows them as fully licensed is telling a manufacturer
 * something that is not true.
 */
function verdictStatus(assessment: Assessment): 'PASS' | 'WARN' | 'FAIL' {
  if (assessment.verdict !== LicenseVerdict.LICENSED) {
    return 'FAIL';
  }
  return assessment.license?.provisional ? 'WARN' : 'PASS';
}

function summarise(assessment: Assessment): LicenceSummary | null {
  const licence = assessment.license;
  if (!licence) {
    return null;
  }
  return {
    id: licence.id,
    licenseNumber: licence.licenseNumber,
    status: licence.status,
    verdict: assessment.verdict,
    grain: grainOf(licence),
    provisional: licence.provisional,
    issuedOn: licence.issuedOn,
    expiresOn: licence.expiresOn,
  };
}

/** One sentence an operator can act on. */
function companyMessage(
  organization: Organization,
  assessment: Assessment,
  activity: LicensedActivity | null,
): string {
  if (!activity) {
    return `${organization.name} does not need a licence for the kind of business it is.`;
  }

  const licence = assessment.license;
  const trade = activity.toLowerCase();

  switch (assessment.verdict) {
    case LicenseVerdict.LICENSED:
      return licence?.provisional
        ? `Trading on provisional licence ${licence.licenseNumber}, issued automatically ` +
            `at registration rather than by a regulator` +
            (licence.expiresOn ? ` and expiring ${licence.expiresOn}` : '') +
            '. Apply for a full licence before it lapses.'
        : `Licensed for ${trade} under ${licence?.licenseNumber}` +
            (licence?.expiresOn ? ` until ${licence.expiresOn}` : '') +
            '.';
    case LicenseVerdict.REVOKED:
      return `Licence ${licence?.licenseNumber} has been revoked. ${organization.name} cannot trade.`;
    case LicenseVerdict.SUSPENDED:
      return (
        `Licence ${licence?.licenseNumber} is suspended` +
        (licence?.statusReason ? ` — ${licence.statusReason}` : '') +
        '. Returns and recalls remain available.'
      );
    case LicenseVerdict.EXPIRED:
      return (
        `Licence ${licence?.licenseNumber} has lapsed` +
        (licence?.expiresOn ? ` (expired ${licence.expiresOn})` : '') +
        '. Renew it to carry on trading.'
      );
    default:
      return `${organization.name} holds no licence for ${trade}. Apply for one.`;
  }
}

function siteMessage(
  site: Facility,
  assessment: Assessment,
  inherited: boolean,
  activity: LicensedActivity | null,
): string {
  if (!activity) {
    return `${site.name} needs no licence of its own.`;
  }

  const licence = assessment.license;
  const closed = site.active
    ? ''
    : ' This site is closed, so nothing is produced here in any case.';

  switch (assessment.verdict) {
    case LicenseVerdict.LICENSED:
      if (inherited) {
        return (
          `Covered by the company licence ${licence?.licenseNumber}` +
          (licence?.provisional ? ', which is provisional' : '') +
          '.' +
          closed
        );
      }
      return (
        `${site.name} holds its own licence ${licence?.licenseNumber}` +
        (licence?.expiresOn ? `, valid to ${licence.expiresOn}` : '') +
        '.' +
        closed
      );
    case LicenseVerdict.REVOKED:
      return `The licence covering ${site.name}, ${licence?.licenseNumber}, has been revoked.${closed}`;
    case LicenseVerdict.SUSPENDED:
      return (
        `${site.name} is suspended under ${licence?.licenseNumber}` +
        (licence?.statusReason ? ` — ${licence.statusReason}` : '') +
        (inherited
          ? '. The suspension is on the company licence, so every site is affected.'
          : '. Other sites of this business are unaffected.') +
        closed
      );
    case LicenseVerdict.EXPIRED:
      return inherited
        ? `The company licence ${licence?.licenseNumber} covering ${site.name} has lapsed` +
            (licence?.expiresOn ? ` (expired ${licence.expiresOn})` : '') +
            `.${closed}`
        : `${site.name}'s own licence ${licence?.licenseNumber} has lapsed` +
            (licence?.expiresOn ? ` (expired ${licence.expiresOn})` : '') +
            '. A site with its own licence no longer relies on the company one, ' +
            `so it cannot produce until this is renewed.${closed}`;
    default:
      return `No licence authorises work at ${site.name}.${closed}`;
  }
}

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

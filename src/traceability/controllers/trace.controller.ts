import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability, capabilitiesFor } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import {
  ActingOrg,
  CurrentUser,
  OptionalActingOrg,
  Public,
  RequireCapability,
} from '../../common/decorators';
import { OrganizationRequiredException } from '../../common/errors';
import { view } from '../../item/controllers/item.controller';
import { ItemKind } from '../../item/item.enums';
import { ItemService } from '../../item/services/item.service';
import { availableActions } from '../available-actions';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { RateLimit } from '../../security/rate-limit.guard';
import { TraceabilityService } from '../services/traceability.service';
import { LicenseEnforcementService } from '../../licensing/services/license-enforcement.service';
import { LicensedActivity } from '../../licensing/licensing.enums';

/**
 * The product lifecycle timeline. Requires an account and a stake in the
 * item's history: the full chain names which businesses handled a product,
 * which is commercially sensitive and not public information.
 */
@ApiTags('Trace')
@ApiBearerAuth()
@Controller('api/trace')
export class TraceController {
  constructor(
    private readonly traceability: TraceabilityService,
    private readonly itemService: ItemService,
    private readonly enforcement: LicenseEnforcementService,
  ) {}

  /**
   * Everything known about one identity, and everything that can be done to it.
   *
   * This is the working screen, not a report. An operator arrives here by
   * scanning the thing in front of them, so the answer carries the whole
   * picture in one response - what it is, what it came from, what is inside it,
   * what container it is inside, where it has been, and which operations are
   * open to this caller right now. Splitting that across a trace page, an
   * inventory page and four operation pages meant re-entering a code that had
   * just been scanned, which is how the wrong pallet gets dispatched.
   */
  /**
   * Codes being scanned far more often than one physical thing could be.
   *
   * Lives here rather than on a screen of its own: this is the counterfeit
   * question, and the counterfeit question is answered on the trace screen,
   * where the operator already is. `?unknownOnly=true` narrows it to codes
   * that resolve to no identity at all.
   *
   * Declared before `:qrCode` deliberately — Nest matches routes in
   * declaration order, and a wildcard segment above it would swallow this
   * path and try to trace an item called "verification-attempts".
   */
  @Get('verification-attempts')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async verificationAttempts(
    @ActingOrg() organization: Organization,
    @Query('unknownOnly') unknownOnly?: string,
    @Query('minAttempts') minAttempts?: string,
    @Query('limit') limit?: string,
  ) {
    const attempts = await this.traceability.verificationAttempts(organization, {
      unknownOnly: unknownOnly === 'true',
      minAttempts: minAttempts ? parseInt(minAttempts, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });

    return {
      attempts,
      /**
       * Said out loud in the payload because a count is not a verdict. A
       * display bottle on a shop counter gets scanned all day by curious
       * customers and is not a fake.
       */
      note: 'Scan counts are a signal to investigate, not evidence of counterfeiting on their own.',
    };
  }

  @Get(':qrCode')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async timeline(
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
    @Param('qrCode') qrCode: string,
  ) {
    const isPlatformOperator = actor.role === UserRole.SYSTEM_ADMIN;
    if (!organization && !isPlatformOperator) {
      throw new OrganizationRequiredException();
    }

    // Platform operators may open any identity for investigation. Business
    // staff still need a stake in its history (or regulator standing).
    const item = organization
      ? await this.itemService.requireVisible(qrCode, organization)
      : await this.itemService.require(qrCode);

    const maySeeConsumer =
      isPlatformOperator ||
      organization?.type === OrganizationType.REGULATOR ||
      item.holder?.id === organization?.id;

    const { entries } = await this.traceability.timeline(item, maySeeConsumer);

    // Containers carry their contents; a unit carries the container it sits in
    // and its siblings' count, which is what an operator holding a box wants.
    const packaging =
      item.kind === ItemKind.PACKAGE
        ? await this.itemService.contents(item)
        : null;

    // Full batch detail: QC inspections, production order, raw materials, facility
    const batchDetail = item.batch?.id
      ? await this.traceability.batchDetail(item.batch.id)
      : null;

    // Manufacturer compliance status
    let manufacturerCompliance: { verdict: string; licenseNumber: string | null } | null = null;
    if (item.batch?.manufacturer) {
      const assessment = await this.enforcement.assess(
        item.batch.manufacturer.id,
        LicensedActivity.MANUFACTURING,
      );
      manufacturerCompliance = {
        verdict: assessment.verdict,
        licenseNumber: assessment.license?.licenseNumber ?? null,
      };
    }

    return {
      item: view(item, maySeeConsumer),
      origin: {
        manufacturerName: item.batch?.manufacturer?.name ?? null,
        facilityName: item.batch?.facility?.name ?? null,
        batchId: item.batch?.id ?? null,
        batchCode: item.batch?.batchCode ?? null,
        batchStatus: item.batch?.status ?? null,
        manufacturedOn: item.batch?.manufacturedOn ?? null,
        expiresOn: item.expiresOn,
      },
      product: item.product
        ? {
            id: item.product.id,
            name: item.product.name,
            sku: item.product.sku,
            category: item.product.category,
            brand: item.product.brand,
            model: item.product.model,
            gtin: item.product.gtin,
            barcodeSymbology: item.product.barcodeSymbology,
            specification: item.product.specification,
          }
        : null,
      /** Where this sits in the packaging hierarchy, innermost first. */
      containedIn: item.parent
        ? {
            id: item.parent.id,
            qrCode: item.parent.qrCode,
            code: item.parent.code,
            packageType: item.parent.packageType,
            sealState: item.parent.sealState,
          }
        : null,
      contents: packaging
        ? {
            remainingCount: packaging.present.length,
            removedCount: packaging.removed.length,
            remaining: packaging.present.map((child) => view(child, false)),
            removed: packaging.removed.map((child) => view(child, false)),
          }
        : null,
      /**
       * What this caller can do from here. Absent entries are operations their
       * role does not cover; present-but-unavailable ones carry the reason,
       * which is a fact about the goods rather than about the person.
       */
      actions: availableActions({
        item,
        organization,
        capabilities: capabilitiesFor(actor.role, organization?.type),
      }),
      batchDetail,
      manufacturerCompliance,
      /**
       * How many times the public verification endpoint has been asked about
       * this code. Includes scans that happened before it was a known
       * identity, which is why it can exceed the VERIFIED events on the
       * timeline rather than matching them.
       */
      verificationCount: await this.traceability.verificationCountFor(item.qrCode),
      eventCount: entries.length,
      events: entries,
    };
  }
}

/**
 * Public product verification - what a consumer gets by scanning a QR without
 * having an account. Unauthenticated by design, and therefore carefully
 * limited to identity and safety information.
 */
@ApiTags('Verification')
@Controller('api/verify')
export class VerificationController {
  constructor(private readonly traceability: TraceabilityService) {}

  // Unauthenticated and answers about any code, so it is capped per address.
  // Generous enough for a shopper checking a shelf, not for bulk probing.
  @Get(':token')
  @Public()
  @RateLimit('verify', 300, 60 * 1000)
  async verify(@Param('token') token: string) {
    return this.traceability.verify(token);
  }
}

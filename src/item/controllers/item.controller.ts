import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { BarcodeService } from '../../barcode/barcode.service';
import { Symbology } from '../../barcode/symbology';
import {
  LifecycleDto,
  PackDto,
  RegisterPackageDto,
  RegisterUnitsDto,
  RemoveUnitDto,
  ScanDto,
} from '../dto/item.dto';
import { TraceableItem } from '../entities/traceable-item.entity';
import { ItemKind } from '../item.enums';
import { ItemService } from '../services/item.service';
import { LifecycleService } from '../services/lifecycle.service';

/**
 * Scanning surface for the identity registry and the packaging hierarchy.
 * Paths accept either the QR payload or the printed code.
 */
@ApiTags('Items')
@ApiBearerAuth()
@Controller('api/items')
export class ItemController {
  constructor(
    private readonly itemService: ItemService,
    private readonly lifecycleService: LifecycleService,
    private readonly barcodes: BarcodeService,
  ) {}

  @Post('units')
  @RequireCapability(Capability.REGISTER_IDENTITY)
  async registerUnits(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: RegisterUnitsDto,
  ) {
    const units = await this.itemService.registerUnits(organization, actor, dto);
    return units.map((unit) => view(unit, true));
  }

  @Post('packages')
  @RequireCapability(Capability.REGISTER_IDENTITY)
  async registerPackage(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: RegisterPackageDto,
  ) {
    return view(
      await this.itemService.registerPackage(organization, actor, dto),
      true,
    );
  }

  /** Everything the caller's organization currently holds. */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('kind') kind?: ItemKind,
    @Query('topLevel') topLevel?: string,
    @Query('productId') productId?: string,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.itemService.listHeld(
      organization,
      kind,
      topLevel === 'true',
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 200),
      productId ? parseInt(productId, 10) || undefined : undefined,
    );
    return { ...result, content: result.content.map((i) => view(i, true)) };
  }

  @Get(':qrCode')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('qrCode') qrCode: string,
  ) {
    const item = await this.itemService.requireVisible(qrCode, organization);
    return view(item, maySeeConsumer(organization, item));
  }

  @Get(':qrCode/contents')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async contents(
    @ActingOrg() organization: Organization,
    @Param('qrCode') qrCode: string,
  ) {
    const container = await this.itemService.requireVisible(qrCode, organization);
    const { present, removed } = await this.itemService.contents(container);
    return {
      container: view(container, maySeeConsumer(organization, container)),
      remainingCount: present.length,
      removedCount: removed.length,
      remaining: present.map((i) => view(i, false)),
      removed: removed.map((i) => view(i, false)),
    };
  }

  @Post(':qrCode/pack')
  @HttpCode(200)
  @RequireCapability(Capability.HANDLE_PACKAGING)
  async pack(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('qrCode') qrCode: string,
    @Body() dto: PackDto,
  ) {
    const container = await this.itemService.pack(organization, actor, qrCode, dto);
    const { present, removed } = await this.itemService.contents(container);
    return {
      container: view(container, true),
      remainingCount: present.length,
      removedCount: removed.length,
      remaining: present.map((i) => view(i, false)),
      removed: removed.map((i) => view(i, false)),
    };
  }

  @Post(':qrCode/open')
  @HttpCode(200)
  @RequireCapability(Capability.HANDLE_PACKAGING)
  async open(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('qrCode') qrCode: string,
    @Body() dto?: ScanDto,
  ) {
    return view(
      await this.itemService.open(organization, actor, qrCode, dto),
      true,
    );
  }

  @Post(':qrCode/remove')
  @HttpCode(200)
  @RequireCapability(Capability.HANDLE_PACKAGING)
  async removeUnit(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('qrCode') qrCode: string,
    @Body() dto: RemoveUnitDto,
  ) {
    const container = await this.itemService.removeUnit(
      organization,
      actor,
      qrCode,
      dto,
    );
    const { present, removed } = await this.itemService.contents(container);
    return {
      container: view(container, true),
      remainingCount: present.length,
      removedCount: removed.length,
      remaining: present.map((i) => view(i, false)),
      removed: removed.map((i) => view(i, false)),
    };
  }

  /** Quarantine, release, return, damage, expiry or destruction. */
  @Post(':qrCode/lifecycle')
  @HttpCode(200)
  @RequireCapability(Capability.APPLY_LIFECYCLE)
  async lifecycle(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('qrCode') qrCode: string,
    @Body() dto: LifecycleDto,
  ) {
    return view(
      await this.lifecycleService.apply(organization, actor, qrCode, dto),
      true,
    );
  }

  /**
   * The printable label for this identity.
   *
   * QR by default, because that is what a phone reads and what a consumer
   * scans. `?symbology=` prints the same identity as something else when the
   * physical thing demands it: a Data Matrix on an ampoule too small for a QR,
   * a Code 128 on a warehouse shelf label, an ITF-14 on the outer carton.
   *
   * The value encoded never changes with the symbology - it is the identity
   * token in every case, so a code printed today still resolves to this item
   * whichever scanner reads it.
   */
  @Get(':qrCode/label')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async label(
    @ActingOrg() organization: Organization,
    @Param('qrCode') qrCode: string,
    @Query('symbology') requested: string | undefined,
    @Query('format') format: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const item = await this.itemService.requireVisible(qrCode, organization);
    const symbology = this.barcodes.parseSymbology(requested, Symbology.QR);
    const label = await this.barcodes.render({
      symbology,
      value: item.qrCode,
      format: format === 'svg' ? 'svg' : 'png',
    });

    response
      .type(label.contentType)
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${item.code}-${symbology}.${label.format}"`,
      )
      .send(label.body);
  }
}

/**
 * Consumer identity is visible to the party that recorded the sale and to
 * regulators, not to everyone who can scan the code (proposal section 8).
 */
function maySeeConsumer(
  organization: Organization,
  item: TraceableItem,
): boolean {
  if (organization.type === OrganizationType.REGULATOR) {
    return true;
  }
  return item.holder?.id === organization.id;
}

/** The current state of one QR identity, shaped for the wire. */
export function view(item: TraceableItem, includeConsumerRef: boolean) {
  return {
    id: item.id,
    qrCode: item.qrCode,
    code: item.code,
    kind: item.kind,
    packageType: item.packageType,
    productId: item.product?.id ?? null,
    productName: item.product?.name ?? null,
    productSku: item.product?.sku ?? null,
    batchId: item.batch?.id ?? null,
    batchCode: item.batch?.batchCode ?? null,
    serialNumber: item.serialNumber,
    quantity: item.quantity,
    status: item.status,
    sealState: item.sealState,
    parentId: item.parent?.id ?? null,
    parentCode: item.parent?.code ?? null,
    holderId: item.holder?.id ?? null,
    holderName: item.holder?.name ?? null,
    locationId: item.location?.id ?? null,
    locationName: item.location?.name ?? null,
    consumerRef: includeConsumerRef ? item.consumerRef : null,
    expiresOn: item.expiresOn,
    expired: item.isExpired(),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

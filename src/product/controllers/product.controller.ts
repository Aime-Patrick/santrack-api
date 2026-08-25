import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability } from '../../auth/capabilities';
import { BarcodeService } from '../../barcode/barcode.service';
import { Symbology, SymbologyUse, specFor } from '../../barcode/symbology';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { CreateProductDto } from '../dto/product.dto';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../entities/product.entity';
import { ProductService } from '../services/product.service';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('api/products')
export class ProductController {
  constructor(
    private readonly products: ProductService,
    private readonly barcodes: BarcodeService,
  ) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(@ActingOrg() org: Organization, @Body() dto: CreateProductDto) {
    return describe(await this.products.create(org.id, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() org: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.products.list(
      org.id,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 200),
    );
    return { ...result, content: result.content.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() org: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.products.get(id, org.id));
  }

  @Put(':id')
  @RequireCapability(Capability.MANAGE_CATALOG)
  async update(
    @ActingOrg() org: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateProductDto,
  ) {
    return describe(await this.products.update(id, org.id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCapability(Capability.MANAGE_CATALOG)
  async remove(
    @ActingOrg() org: Organization,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.products.remove(id, org.id);
  }

  /**
   * A printable catalogue label. This identifies the product, not an item
   * identity - it says "this is a ThinkPad T14", not "this is the ThinkPad T14
   * that left the factory on Tuesday". Per-item labels come from
   * /api/items/:qr/label.
   *
   * `?symbology=` picks the code type; without it the product's own default is
   * used, which is what the catalogue was set up with. A retail pack and the
   * carton it ships in carry different codes for the same product, so the
   * choice belongs at the point of printing.
   *
   * The retail and publication symbologies encode the GTIN, because that is
   * the number a till reads and a SKU is an internal name no scanner knows.
   * Everything else encodes the SKU.
   */
  @Get(':id/qr')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async qr(
    @ActingOrg() org: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Query('symbology') requested: string | undefined,
    @Query('format') format: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const product = await this.products.get(id, org.id);
    const symbology = this.barcodes.parseSymbology(
      requested,
      product.barcodeSymbology ?? Symbology.QR,
    );
    const label = await this.barcodes.render({
      symbology,
      value: encodedValueFor(product, symbology),
      format: format === 'svg' ? 'svg' : 'png',
    });

    response
      .type(label.contentType)
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${product.sku}-${symbology}.${label.format}"`,
      )
      .send(label.body);
  }
}

/**
 * What a product's label should actually carry.
 *
 * A retail scanner looks up a GTIN; it has never heard of our SKU. So the
 * symbologies that exist to be read at a till or a border encode the GTIN, and
 * refusing loudly when there is none is better than printing a barcode of an
 * internal code that will not resolve to anything at the checkout.
 */
export function encodedValueFor(product: Product, symbology: Symbology): string {
  const spec = specFor(symbology);
  const needsGtin =
    spec.use === SymbologyUse.RETAIL || spec.use === SymbologyUse.PUBLICATION;

  if (!needsGtin) {
    return product.sku;
  }
  if (!product.gtin) {
    throw new TraceabilityRuleException(
      `${spec.label} encodes the manufacturer barcode, and ${product.sku} has no GTIN recorded. Add one to the product, or print an internal code type such as Code 128.`,
    );
  }
  return product.gtin;
}

function describe(product: Product) {
  return {
    id: product.id,
    organizationId: product.organizationId,
    name: product.name,
    sku: product.sku,
    categoryId: product.categoryId,
    categoryCode: product.productCategory?.code ?? null,
    categoryName: product.productCategory?.name ?? null,
    /**
     * The original free-text value. Still reported so existing clients keep
     * working through the transition, and so a product classified before the
     * taxonomy existed still describes itself. New writes never set it.
     *
     * @deprecated Read `categoryCode`.
     */
    category: product.category,
    brand: product.productBrand?.name ?? product.brand,
    brandId: product.brandId,
    brandCode: product.productBrand?.code ?? null,
    model: product.model,
    specification: product.specification,
    gtin: product.gtin,
    barcodeSymbology: product.barcodeSymbology,
    traceabilityLevel: product.traceabilityLevel,
  };
}

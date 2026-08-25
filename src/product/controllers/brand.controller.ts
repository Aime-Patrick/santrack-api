import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateBrandDto, UpdateBrandDto } from '../dto/brand.dto';
import { Brand } from '../entities/brand.entity';
import { Product } from '../entities/product.entity';
import { deriveCode } from '../derive-code';

/**
 * The marks a business files its products under.
 *
 * Every route is scoped to the caller's own organization. A brand list is
 * commercially revealing — it says what a company is about to launch — so
 * another business's brands read as absent rather than forbidden, the same way
 * facilities and licences answer.
 */
@ApiTags('Brands')
@ApiBearerAuth()
@Controller('api/brands')
export class BrandController {
  constructor(
    @InjectRepository(Brand)
    private readonly brands: Repository<Brand>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const rows = await this.brands.find({
      where: { organizationId: organization.id },
      order: { name: 'ASC' },
    });
    const counts = await this.productCounts(organization.id);
    return rows.map((brand) => this.describe(brand, counts));
  }

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateBrandDto,
  ) {
    const name = dto.name.trim();
    const code = deriveCode(name);
    if (!code) {
      throw new TraceabilityRuleException(
        `"${name}" has no letters or digits to build a code from`,
      );
    }

    const clash = await this.brands.findOne({
      where: { organizationId: organization.id, code },
    });
    if (clash) {
      throw new TraceabilityRuleException(
        `${clash.name} is already one of your brands`,
      );
    }

    const brand = await this.brands.save(
      this.brands.create({
        organization,
        organizationId: organization.id,
        code,
        name,
        active: true,
      }),
    );
    return this.describe(brand, {});
  }

  /**
   * Renames or reinstates a brand. The code is fixed, as with a category:
   * products refer to the brand by id, but rules and exports read the code, and
   * a rename that re-points them silently is not a rename.
   */
  @Patch(':id')
  @RequireCapability(Capability.MANAGE_CATALOG)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBrandDto,
  ) {
    const brand = await this.requireOwn(organization, id);

    if (dto.name !== undefined) {
      brand.name = dto.name.trim();
    }
    if (dto.active !== undefined) {
      brand.active = dto.active;
    }

    await this.brands.save(brand);
    return this.describe(brand, await this.productCounts(organization.id));
  }

  /**
   * Withdraws a brand. Never deleted — products filed under it still have to
   * say what they were sold as.
   */
  @Delete(':id')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CATALOG)
  async withdraw(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const brand = await this.requireOwn(organization, id);
    brand.active = false;
    await this.brands.save(brand);
    return this.describe(brand, await this.productCounts(organization.id));
  }

  // ------------------------------------------------------------------ shared

  private async requireOwn(
    organization: Organization,
    id: number,
  ): Promise<Brand> {
    const brand = await this.brands.findOne({ where: { id } });
    if (!brand || brand.organizationId !== organization.id) {
      throw new NotFoundEntityException('Brand', id);
    }
    return brand;
  }

  /** How many products carry each brand, and which categories they sit in. */
  private async productCounts(
    organizationId: number,
  ): Promise<Record<number, { products: number; categories: string[] }>> {
    const rows = await this.products
      .createQueryBuilder('product')
      .leftJoin('product_categories', 'category', 'category.id = product.category_id')
      .select('product.brand_id', 'brandId')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        "array_remove(array_agg(DISTINCT category.name), NULL)",
        'categories',
      )
      .where('product.brand_id IS NOT NULL')
      .andWhere('product.organization_id = :organizationId', { organizationId })
      .groupBy('product.brand_id')
      .getRawMany<{ brandId: number; count: string; categories: string[] }>();

    return Object.fromEntries(
      rows.map((row) => [
        row.brandId,
        { products: Number(row.count), categories: row.categories ?? [] },
      ]),
    );
  }

  private describe(
    brand: Brand,
    counts: Record<number, { products: number; categories: string[] }>,
  ) {
    const stats = counts[brand.id];
    return {
      id: brand.id,
      code: brand.code,
      name: brand.name,
      active: brand.active,
      productCount: stats?.products ?? 0,
      /** Derived, never stored — a brand belongs to no category of its own. */
      categories: stats?.categories ?? [],
    };
  }
}

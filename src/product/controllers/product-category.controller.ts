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
import { Not, Repository } from 'typeorm';
import { Capability } from '../../auth/capabilities';
import { RequireCapability } from '../../common/decorators';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import {
  CreateProductCategoryDto,
  UpdateProductCategoryDto,
} from '../dto/product-category.dto';
import { Product } from '../entities/product.entity';
import { ProductCategory } from '../entities/product-category.entity';
import { deriveCode } from '../derive-code';

/**
 * The canonical product taxonomy.
 *
 * Reading is open to anyone who can view operations — a product has to be able
 * to say what it is. Writing is held to MANAGE_CATALOG, the same capability
 * that creates the products being filed: a manufacturer who cannot name a kind
 * of goods cannot register the goods either, and waiting on the platform
 * operator to add "Dairy" before the first product can exist is not a workable
 * onboarding.
 *
 * This answers the question DR-05 left open, and it answers it the permissive
 * way, so the risk it was guarding against is live: categories are global, and
 * nothing stops two businesses filing the same goods under DAIRY and
 * DAIRY_PRODUCTS. Since regulatory standards attach to a category, a standard
 * on one would not reach the other. Codes are unique platform-wide and the list
 * shows every existing category before you add one, which makes duplication
 * visible rather than impossible. If it becomes a problem, the answer is
 * review of proposed categories, not narrowing this back to the operator.
 */
@ApiTags('Product Categories')
@ApiBearerAuth()
@Controller('api/product-categories')
export class ProductCategoryController {
  constructor(
    @InjectRepository(ProductCategory)
    private readonly categories: Repository<ProductCategory>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /**
   * Every category a product may be filed under.
   *
   * Withdrawn ones are included, flagged rather than hidden: a product
   * classified years ago still needs its category to have a name.
   */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list() {
    const rows = await this.categories.find({ order: { code: 'ASC' } });
    const counts = await this.productCounts();
    return rows.map((category) => this.describe(category, counts));
  }

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(@Body() dto: CreateProductCategoryDto) {
    const name = dto.name.trim();
    const code = dto.code?.trim().toUpperCase() ?? deriveCode(name);
    if (!code) {
      throw new TraceabilityRuleException(
        `"${name}" has no letters or digits to build a code from. Give the category a name, or supply a code.`,
      );
    }

    const clash = await this.categories.findOne({ where: { code } });
    if (clash) {
      // Named rather than coded: whoever hit this typed a name, and the code
      // is machinery they never saw.
      throw new TraceabilityRuleException(
        `${clash.name} already covers this — pick a different name`,
      );
    }

    const parent = await this.resolveParent(dto.parentId ?? null);
    const category = await this.categories.save(
      this.categories.create({
        code,
        name,
        parentId: parent?.id ?? null,
        active: true,
      }),
    );
    return this.describe(category, {});
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_CATALOG)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    const category = await this.require(id);

    if (dto.name !== undefined) {
      category.name = dto.name.trim();
    }
    if (dto.parentId !== undefined) {
      const parent = await this.resolveParent(dto.parentId, category.id);
      category.parentId = parent?.id ?? null;
    }
    if (dto.active !== undefined) {
      category.active = dto.active;
    }

    await this.categories.save(category);
    return this.describe(category, await this.productCounts());
  }

  /**
   * Withdraws a category. It is never deleted.
   *
   * Products keep pointing at it, so removing the row would leave them unable
   * to say what they are — the same reason a withdrawn LicenseCategory stays.
   * A category with children is refused rather than orphaning them.
   */
  @Delete(':id')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CATALOG)
  async withdraw(@Param('id', ParseIntPipe) id: number) {
    const category = await this.require(id);

    const children = await this.categories.count({
      where: { parentId: category.id, active: true },
    });
    if (children > 0) {
      throw new TraceabilityRuleException(
        `${category.name} still has ${children} active ${children === 1 ? 'subcategory' : 'subcategories'}. Withdraw those first.`,
      );
    }

    category.active = false;
    await this.categories.save(category);
    return this.describe(category, await this.productCounts());
  }

  // ------------------------------------------------------------------ shared

  private async require(id: number): Promise<ProductCategory> {
    const category = await this.categories.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundEntityException('Product category', id);
    }
    return category;
  }

  /**
   * A parent that exists, is not the category itself, and is not one of its
   * own descendants — a cycle in the taxonomy is a tree that cannot be walked.
   */
  private async resolveParent(
    parentId: number | null,
    selfId?: number,
  ): Promise<ProductCategory | null> {
    if (parentId === null || parentId === undefined) {
      return null;
    }
    if (selfId !== undefined && parentId === selfId) {
      throw new TraceabilityRuleException(
        'A category cannot be its own parent',
      );
    }

    const parent = await this.require(parentId);

    if (selfId !== undefined) {
      let ancestor: ProductCategory | null = parent;
      while (ancestor?.parentId) {
        if (ancestor.parentId === selfId) {
          throw new TraceabilityRuleException(
            `${parent.name} sits under this category, so it cannot also be its parent`,
          );
        }
        ancestor = await this.categories.findOne({
          where: { id: ancestor.parentId },
        });
      }
    }

    return parent;
  }

  /** How many products are filed under each category. */
  private async productCounts(): Promise<Record<number, number>> {
    const rows = await this.products
      .createQueryBuilder('product')
      .select('product.category_id', 'categoryId')
      .addSelect('COUNT(*)', 'count')
      .where('product.category_id IS NOT NULL')
      .groupBy('product.category_id')
      .getRawMany<{ categoryId: number; count: string }>();

    return Object.fromEntries(
      rows.map((row) => [row.categoryId, Number(row.count)]),
    );
  }

  private describe(
    category: ProductCategory,
    counts: Record<number, number>,
  ) {
    return {
      id: category.id,
      code: category.code,
      name: category.name,
      parentId: category.parentId,
      active: category.active,
      productCount: counts[category.id] ?? 0,
    };
  }
}

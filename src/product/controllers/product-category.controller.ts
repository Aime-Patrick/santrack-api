import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { Capability } from '../../auth/capabilities';
import { RequireCapability } from '../../common/decorators';
import { ProductCategory } from '../entities/product-category.entity';

/**
 * The canonical product taxonomy.
 *
 * Read-only for now. Categories are seeded by migration, and who may create
 * them is a governance question DR-05 deliberately left open — the platform
 * owns the taxonomy, but whether authorities may extend it is undecided.
 * Shipping a write endpoint before that is settled would answer it by accident.
 */
@ApiTags('Product Categories')
@ApiBearerAuth()
@Controller('api/product-categories')
export class ProductCategoryController {
  constructor(
    @InjectRepository(ProductCategory)
    private readonly categories: Repository<ProductCategory>,
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
    return rows.map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      parentId: category.parentId,
      active: category.active,
    }));
  }
}

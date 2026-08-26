import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { User } from '../../auth/entities/user.entity';
import { BarcodeService } from '../../barcode/barcode.service';
import { Symbology } from '../../barcode/symbology';
import { Batch } from '../../batch/entities/batch.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { Product } from '../entities/product.entity';
import { ProductCategory } from '../entities/product-category.entity';
import { CategoryShareLink } from '../entities/category-share-link.entity';

export interface CategoryShareView {
  token: string;
  url: string;
  categoryId: number;
  organizationId: number;
  createdAt: Date;
  rotatedAt: Date | null;
}

export interface PublicCategorySharePayload {
  known: boolean;
  category?: {
    code: string;
    name: string;
    active: boolean;
  };
  organization?: {
    name: string;
  };
  products?: Array<{
    name: string;
    sku: string;
    brand: string | null;
    gtin: string | null;
  }>;
}

export interface CategoryDetailPayload {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  parent: { id: number; code: string; name: string } | null;
  active: boolean;
  children: Array<{ id: number; code: string; name: string; active: boolean }>;
  share: CategoryShareView;
  summary: {
    productCount: number;
    batchCount: number;
    unitCount: number;
    unitsByStatus: Record<string, number>;
    batchesByStatus: Record<string, number>;
  };
  products: Array<{
    id: number;
    name: string;
    sku: string;
    brand: string | null;
    gtin: string | null;
    batchCount: number;
    unitCount: number;
    unitsByStatus: Record<string, number>;
  }>;
}

@Injectable()
export class CategoryShareService {
  constructor(
    @InjectRepository(CategoryShareLink)
    private readonly links: Repository<CategoryShareLink>,
    @InjectRepository(ProductCategory)
    private readonly categories: Repository<ProductCategory>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    private readonly barcodes: BarcodeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Everything this organization has under the category: products, lot and
   * unit counts, lifecycle status breakdown, and the live share link.
   */
  async getDetail(
    categoryId: number,
    organization: Organization,
    actor?: User | null,
  ): Promise<CategoryDetailPayload> {
    const category = await this.requireCategory(categoryId);

    const parent = category.parentId
      ? await this.categories.findOne({ where: { id: category.parentId } })
      : null;

    const children = await this.categories.find({
      where: { parentId: category.id },
      order: { code: 'ASC' },
    });

    const products = await this.products.find({
      where: { categoryId: category.id, organizationId: organization.id },
      order: { name: 'ASC' },
      relations: { productBrand: true },
    });

    const productIds = products.map((p) => p.id);
    const batchRows =
      productIds.length === 0
        ? []
        : await this.batches
            .createQueryBuilder('batch')
            .select('batch.product_id', 'productId')
            .addSelect('batch.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .where('batch.product_id IN (:...productIds)', { productIds })
            .groupBy('batch.product_id')
            .addGroupBy('batch.status')
            .getRawMany<{ productId: number; status: string; count: string }>();

    const itemRows =
      productIds.length === 0
        ? []
        : await this.items
            .createQueryBuilder('item')
            .select('item.product_id', 'productId')
            .addSelect('item.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .where('item.product_id IN (:...productIds)', { productIds })
            .groupBy('item.product_id')
            .addGroupBy('item.status')
            .getRawMany<{ productId: number; status: string; count: string }>();

    const batchesByProduct = groupCounts(batchRows);
    const unitsByProduct = groupCounts(itemRows);

    const unitsByStatus: Record<string, number> = {};
    const batchesByStatus: Record<string, number> = {};
    let batchCount = 0;
    let unitCount = 0;

    for (const row of batchRows) {
      const n = Number(row.count);
      batchCount += n;
      batchesByStatus[row.status] = (batchesByStatus[row.status] ?? 0) + n;
    }
    for (const row of itemRows) {
      const n = Number(row.count);
      unitCount += n;
      unitsByStatus[row.status] = (unitsByStatus[row.status] ?? 0) + n;
    }

    const share = await this.ensure(category.id, organization, actor);

    return {
      id: category.id,
      code: category.code,
      name: category.name,
      parentId: category.parentId,
      parent: parent
        ? { id: parent.id, code: parent.code, name: parent.name }
        : null,
      active: category.active,
      children: children.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        active: c.active,
      })),
      share,
      summary: {
        productCount: products.length,
        batchCount,
        unitCount,
        unitsByStatus,
        batchesByStatus,
      },
      products: products.map((product) => {
        const batchMap = batchesByProduct.get(product.id) ?? {};
        const unitMap = unitsByProduct.get(product.id) ?? {};
        return {
          id: product.id,
          name: product.name,
          sku: product.sku,
          brand: product.productBrand?.name ?? null,
          gtin: product.gtin,
          batchCount: Object.values(batchMap).reduce((a, b) => a + b, 0),
          unitCount: Object.values(unitMap).reduce((a, b) => a + b, 0),
          unitsByStatus: unitMap,
        };
      }),
    };
  }

  /** Returns the live link, minting one if this org has never shared the category. */
  async ensure(
    categoryId: number,
    organization: Organization,
    actor?: User | null,
  ): Promise<CategoryShareView> {
    await this.requireCategory(categoryId);

    const existing = await this.links.findOne({
      where: {
        categoryId,
        organizationId: organization.id,
        active: true,
      },
    });
    if (existing) {
      return this.describe(existing);
    }

    return this.mint(categoryId, organization, actor ?? null);
  }

  async rotate(
    categoryId: number,
    organization: Organization,
    actor?: User | null,
  ): Promise<CategoryShareView> {
    await this.requireCategory(categoryId);

    const current = await this.links.findOne({
      where: {
        categoryId,
        organizationId: organization.id,
        active: true,
      },
    });
    if (current) {
      current.active = false;
      current.rotatedAt = new Date();
      await this.links.save(current);
    }

    return this.mint(categoryId, organization, actor ?? null);
  }

  /**
   * Public resolve. Unknown or inactive tokens return `{ known: false }` —
   * never a dump that confirms category existence by id.
   */
  async resolvePublic(token: string): Promise<PublicCategorySharePayload> {
    const trimmed = token.trim();
    if (!trimmed) {
      return { known: false };
    }

    const link = await this.links.findOne({
      where: { token: trimmed, active: true },
      relations: { category: true, organization: true },
    });
    if (!link?.category || !link.organization) {
      return { known: false };
    }

    const products = await this.products.find({
      where: {
        categoryId: link.categoryId,
        organizationId: link.organizationId,
      },
      order: { name: 'ASC' },
      relations: { productBrand: true },
    });

    return {
      known: true,
      category: {
        code: link.category.code,
        name: link.category.name,
        active: link.category.active,
      },
      organization: {
        name: link.organization.name,
      },
      products: products.map((product) => ({
        name: product.name,
        sku: product.sku,
        brand: product.productBrand?.name ?? null,
        gtin: product.gtin,
      })),
    };
  }

  async renderQr(
    categoryId: number,
    organization: Organization,
    format: 'png' | 'svg' = 'png',
    actor?: User | null,
  ) {
    const share = await this.ensure(categoryId, organization, actor);
    const category = await this.requireCategory(categoryId);
    const label = await this.barcodes.render({
      symbology: Symbology.QR,
      value: share.url,
      format,
      scale: 4,
    });

    return {
      ...label,
      filename: `${category.code}-share.${label.format}`,
    };
  }

  shareUrl(token: string): string {
    return `${this.appPublicUrl()}/c/${token}`;
  }

  private async mint(
    categoryId: number,
    organization: Organization,
    actor: User | null,
  ): Promise<CategoryShareView> {
    const link = await this.links.save(
      this.links.create({
        categoryId,
        organizationId: organization.id,
        token: randomUUID(),
        active: true,
        rotatedAt: null,
        createdByUserId: actor?.id ?? null,
      }),
    );
    return this.describe(link);
  }

  private describe(link: CategoryShareLink): CategoryShareView {
    return {
      token: link.token,
      url: this.shareUrl(link.token),
      categoryId: link.categoryId,
      organizationId: link.organizationId,
      createdAt: link.createdAt,
      rotatedAt: link.rotatedAt,
    };
  }

  private async requireCategory(id: number): Promise<ProductCategory> {
    const category = await this.categories.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundEntityException('Product category', id);
    }
    return category;
  }

  private appPublicUrl(): string {
    const configured = this.config.get<string>('appPublicUrl');
    if (configured) return configured.replace(/\/$/, '');
    const origins = this.config.get<string[]>('corsOrigins') ?? [];
    return (origins[0] ?? 'http://localhost:3000').replace(/\/$/, '');
  }
}

function groupCounts(
  rows: Array<{ productId: number; status: string; count: string }>,
): Map<number, Record<string, number>> {
  const map = new Map<number, Record<string, number>>();
  for (const row of rows) {
    const id = Number(row.productId);
    const bucket = map.get(id) ?? {};
    bucket[row.status] = (bucket[row.status] ?? 0) + Number(row.count);
    map.set(id, bucket);
  }
  return map;
}

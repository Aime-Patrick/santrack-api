import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  DuplicateException,
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { CreateProductDto } from '../dto/product.dto';
import { Product } from '../entities/product.entity';
import { ProductCategory } from '../entities/product-category.entity';
import { TraceabilityLevel } from '../traceability-level.enum';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(ProductCategory)
    private readonly categories: Repository<ProductCategory>,
  ) {}

  /**
   * Reads the category off a request, refusing anything that is not a real one.
   *
   * Free text is rejected outright rather than ignored. A client that sends
   * `category: "Dairy"` and gets a silent success would believe the product was
   * classified when it was not, and that belief is exactly what the taxonomy
   * exists to prevent (DR-05).
   */
  private async resolveCategory(dto: CreateProductDto): Promise<number | null> {
    if (dto.category !== undefined && dto.category !== null) {
      throw new TraceabilityRuleException(
        'Product categories come from the catalogue now: send categoryId ' +
          'instead of a category name. Ask GET /api/product-categories for the list.',
      );
    }

    if (dto.categoryId === undefined || dto.categoryId === null) {
      return null;
    }

    const category = await this.categories.findOne({
      where: { id: dto.categoryId },
    });
    if (!category) {
      throw new NotFoundEntityException('ProductCategory', dto.categoryId);
    }
    if (!category.active) {
      throw new TraceabilityRuleException(
        `${category.name} has been withdrawn and cannot be assigned to new products`,
      );
    }
    return category.id;
  }

  async create(organizationId: number, dto: CreateProductDto): Promise<Product> {
    const sku = dto.sku?.trim() || generateSku();

    if (
      await this.products.findOne({
        where: { organizationId, sku },
      })
    ) {
      throw new DuplicateException(
        `A product with SKU ${sku} already exists in this organization`,
      );
    }

    const saved = await this.products.save(
      this.products.create({
        organizationId,
        name: dto.name.trim(),
        sku,
        categoryId: await this.resolveCategory(dto),
        // The legacy string is no longer written. Existing rows keep theirs as
        // the record of what was originally typed (DR-05).
        category: null,
        brand: dto.brand ?? null,
        model: dto.model ?? null,
        specification: dto.specification ?? null,
        gtin: dto.gtin?.trim() || null,
        barcodeSymbology: dto.barcodeSymbology ?? null,
        traceabilityLevel: dto.traceabilityLevel ?? TraceabilityLevel.SERIAL,
      }),
    );

    // Re-read so the eagerly-loaded category comes back with it. `save` returns
    // what it was handed, so the response would otherwise carry a category id
    // with no code or name beside it.
    return this.get(saved.id, organizationId);
  }

  async list(organizationId: number, page: number, size: number) {
    const [content, total] = await this.products.findAndCount({
      where: { organizationId },
      order: { name: 'ASC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async get(productId: number, organizationId?: number): Promise<Product> {
    const where: Record<string, any> = { id: productId };
    if (organizationId) where.organizationId = organizationId;

    const product = await this.products.findOne({ where });
    if (!product) {
      throw new NotFoundEntityException('Product', productId);
    }
    return product;
  }

  async update(
    productId: number,
    organizationId: number,
    dto: CreateProductDto,
  ): Promise<Product> {
    const product = await this.get(productId, organizationId);
    const sku = dto.sku?.trim() || product.sku;

    if (sku !== product.sku) {
      const existing = await this.products.findOne({
        where: { organizationId, sku },
      });
      if (existing) {
        throw new DuplicateException(
          `A product with SKU ${sku} already exists in this organization`,
        );
      }
    }

    /**
     * Resolved unconditionally, so free text is refused on update as well as on
     * create. Guarding this on `categoryId` being present left the door open:
     * a request carrying only `category: "Dairy"` skipped the check entirely
     * and was silently accepted, which is the exact failure the taxonomy exists
     * to prevent. The result is only *applied* when a categoryId was actually
     * sent, so an update that mentions neither leaves the category alone.
     */
    const resolved = await this.resolveCategory(dto);

    Object.assign(product, {
      name: dto.name.trim(),
      sku,
      categoryId: dto.categoryId !== undefined ? resolved : product.categoryId,
      brand: dto.brand ?? product.brand,
      model: dto.model ?? product.model,
      specification: dto.specification ?? product.specification,
      gtin: dto.gtin?.trim() || product.gtin,
      barcodeSymbology: dto.barcodeSymbology ?? product.barcodeSymbology,
      traceabilityLevel: dto.traceabilityLevel ?? product.traceabilityLevel,
    });
    const saved = await this.products.save(product);
    return this.get(saved.id, organizationId);
  }

  /**
   * Removes a catalogue definition.
   *
   * Refused once anything physical has been made from it: those identities and
   * their history reference this product, and a traceability record that
   * cannot say what the product was is not a traceability record. Retiring a
   * live product is a catalogue-status change, not a delete.
   */
  async remove(productId: number, organizationId?: number): Promise<void> {
    const product = await this.get(productId, organizationId);

    const minted = await this.items.count({
      where: { product: { id: productId } },
    });
    if (minted > 0) {
      throw new TraceabilityRuleException(
        `${product.name} cannot be deleted: ${minted} identities have been registered against it`,
      );
    }

    await this.products.remove(product);
  }
}

function generateSku(): string {
  return `SKU-${randomUUID().slice(0, 8).toUpperCase()}`;
}

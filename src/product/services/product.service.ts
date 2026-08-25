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
import { Brand } from '../entities/brand.entity';
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
    @InjectRepository(Brand)
    private readonly brands: Repository<Brand>,
  ) {}

  /**
   * Reads the category off a request, refusing anything that is not a real one.
   *
   * Free text is rejected outright rather than ignored. A client that sends
   * `category: "Dairy"` and gets a silent success would believe the product was
   * classified when it was not, and that belief is exactly what the taxonomy
   * exists to prevent (DR-05).
   */
  /**
   * The brand this product is sold under, checked to be one of the caller's
   * own.
   *
   * Another organization's brand reads as absent rather than forbidden, the
   * same answer the brands endpoint gives — a 403 would confirm that a brand
   * with that id exists, and a competitor's brand list is exactly the thing
   * worth not confirming.
   */
  private async resolveBrand(
    organizationId: number,
    dto: CreateProductDto,
  ): Promise<number | null> {
    if (dto.brand !== undefined && dto.brand !== null) {
      throw new TraceabilityRuleException(
        'Brands come from your own list now: send brandId instead of a brand ' +
          'name. Ask GET /api/brands for the list.',
      );
    }

    if (dto.brandId === undefined || dto.brandId === null) {
      return null;
    }

    const brand = await this.brands.findOne({ where: { id: dto.brandId } });
    if (!brand || brand.organizationId !== organizationId) {
      throw new NotFoundEntityException('Brand', dto.brandId);
    }
    if (!brand.active) {
      throw new TraceabilityRuleException(
        `${brand.name} has been withdrawn and cannot be assigned to new products`,
      );
    }
    return brand.id;
  }

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

  /**
   * The unit model, checked as a set rather than field by field (DR-09).
   *
   * A pack with no size cannot be converted, and a size with no pack has
   * nothing to name, so half a definition is refused rather than stored — a
   * product carrying `unitsPerPack: 24` and no `packUnit` would offer a sales
   * unit nobody can put a word to.
   *
   * The check runs against the *result* of the change, not the payload sent.
   * Sending only `packUnit` to a product that already has a size is a complete
   * definition; sending only `unitsPerPack` to one with no pack is not, and the
   * difference is invisible if you look at the request alone.
   */
  private resolvePackaging(
    dto: CreateProductDto,
    current?: Product,
  ): Pick<Product, 'baseUnit' | 'packUnit' | 'unitsPerPack'> {
    const baseUnit = text(dto.baseUnit, current?.baseUnit);
    const packUnit = text(dto.packUnit, current?.packUnit);
    const unitsPerPack =
      dto.unitsPerPack !== undefined
        ? (dto.unitsPerPack ?? null)
        : (current?.unitsPerPack ?? null);

    if ((packUnit === null) !== (unitsPerPack === null)) {
      throw new TraceabilityRuleException(
        packUnit === null
          ? `A pack size of ${unitsPerPack} needs a pack to name: send packUnit with it`
          : `${packUnit} needs a size: send unitsPerPack with it`,
      );
    }

    return { baseUnit, packUnit, unitsPerPack };
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

    const gtin = dto.gtin?.trim() || null;
    if (gtin) {
      const existingWithGtin = await this.products.findOne({
        where: { gtin },
      });
      if (existingWithGtin) {
        throw new DuplicateException(
          `A product with Barcode / GTIN "${gtin}" already exists in the catalog (${existingWithGtin.name})`,
        );
      }
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
        brandId: await this.resolveBrand(organizationId, dto),
        // The legacy string is no longer written, as with `category`.
        brand: null,
        model: dto.model ?? null,
        specification: dto.specification ?? null,
        gtin,
        barcodeSymbology: dto.barcodeSymbology ?? null,
        traceabilityLevel: dto.traceabilityLevel ?? TraceabilityLevel.SERIAL,
        ...this.resolvePackaging(dto),
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

    const gtin = dto.gtin !== undefined ? (dto.gtin?.trim() || null) : product.gtin;
    if (gtin && gtin !== product.gtin) {
      const existingWithGtin = await this.products.findOne({
        where: { gtin },
      });
      if (existingWithGtin && existingWithGtin.id !== product.id) {
        throw new DuplicateException(
          `A product with Barcode / GTIN "${gtin}" already exists in the catalog (${existingWithGtin.name})`,
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
      ...this.resolvePackaging(dto, product),
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

/**
 * The value a text field ends up with: what was sent if anything was, otherwise
 * what is already held. Blank counts as clearing it, so a field emptied in a
 * form does not come back as the string it used to be.
 */
function text(sent: string | undefined, held: string | null | undefined): string | null {
  if (sent === undefined) {
    return held ?? null;
  }
  return sent.trim() || null;
}

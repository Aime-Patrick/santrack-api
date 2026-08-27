import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Batch } from '../batch/entities/batch.entity';
import { Customer } from '../commerce/entities/customer.entity';
import { TraceableItem } from '../item/entities/traceable-item.entity';
import { Organization } from '../organization/entities/organization.entity';
import { Product } from '../product/entities/product.entity';
import { ProductCategory } from '../product/entities/product-category.entity';
import { RedisCacheService } from '../cache/redis-cache.service';

export type SearchHit = {
  type:
    | 'product'
    | 'category'
    | 'batch'
    | 'customer'
    | 'item'
    | 'organization'
    | 'user';
  id: number;
  title: string;
  subtitle: string | null;
  href: string;
};

export type SearchResponse = {
  query: string;
  cached: boolean;
  results: SearchHit[];
};

const CACHE_TTL_SECONDS = 90;
const LIMIT_PER_TYPE = 6;

@Injectable()
export class SearchService {
  constructor(
    private readonly cache: RedisCacheService,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(ProductCategory)
    private readonly categories: Repository<ProductCategory>,
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async search(organizationId: number, rawQuery: string): Promise<SearchResponse> {
    const query = rawQuery.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (query.length < 2) {
      return { query, cached: false, results: [] };
    }

    const cacheKey = `search:v1:${organizationId}:${query.toLowerCase()}`;
    const hit = await this.cache.getJson<SearchResponse>(cacheKey);
    if (hit) {
      return { ...hit, cached: true };
    }

    const pattern = `%${query}%`;
    const [products, categories, batches, customers, items] = await Promise.all([
      this.products.find({
        where: [
          { organizationId, name: ILike(pattern) },
          { organizationId, sku: ILike(pattern) },
          { organizationId, gtin: ILike(pattern) },
        ],
        take: LIMIT_PER_TYPE,
        order: { name: 'ASC' },
      }),
      this.categories.find({
        where: [{ name: ILike(pattern) }, { code: ILike(pattern) }],
        take: LIMIT_PER_TYPE,
        order: { name: 'ASC' },
      }),
      this.batches
        .createQueryBuilder('batch')
        .innerJoinAndSelect('batch.product', 'product')
        .where('product.organization_id = :organizationId', { organizationId })
        .andWhere(
          '(batch.batch_code ILIKE :pattern OR product.name ILIKE :pattern)',
          { pattern },
        )
        .orderBy('batch.batch_code', 'ASC')
        .take(LIMIT_PER_TYPE)
        .getMany(),
      this.customers
        .createQueryBuilder('customer')
        .where('customer.organization_id = :organizationId', { organizationId })
        .andWhere(
          '(customer.name ILIKE :pattern OR customer.code ILIKE :pattern)',
          { pattern },
        )
        .orderBy('customer.name', 'ASC')
        .take(LIMIT_PER_TYPE)
        .getMany(),
      this.items
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.product', 'product')
        .where('item.holder_id = :organizationId', { organizationId })
        .andWhere(
          '(item.code ILIKE :pattern OR item.serial_number ILIKE :pattern)',
          { pattern },
        )
        .orderBy('item.code', 'ASC')
        .take(LIMIT_PER_TYPE)
        .getMany(),
    ]);

    const results: SearchHit[] = [
      ...products.map(
        (p): SearchHit => ({
          type: 'product',
          id: p.id,
          title: p.name,
          subtitle: p.sku,
          href: `/dashboard/products/${p.id}`,
        }),
      ),
      ...categories.map(
        (c): SearchHit => ({
          type: 'category',
          id: c.id,
          title: c.name,
          subtitle: c.code,
          href: `/dashboard/products/categories/${c.id}`,
        }),
      ),
      ...batches.map(
        (b): SearchHit => ({
          type: 'batch',
          id: b.id,
          title: b.batchCode,
          subtitle: b.product?.name ?? null,
          href: `/dashboard/manufacturing/quality`,
        }),
      ),
      ...customers.map(
        (c): SearchHit => ({
          type: 'customer',
          id: c.id,
          title: c.name,
          subtitle: c.code,
          href: `/dashboard/sales/customers`,
        }),
      ),
      ...items.map((i): SearchHit => {
        const subtitle = i.product?.name ?? i.serialNumber ?? null;
        return {
          type: 'item',
          id: i.id,
          title: i.code,
          subtitle,
          href: `/dashboard/manufacturing/trace?code=${encodeURIComponent(i.code)}`,
        };
      }),
    ];

    const payload: SearchResponse = { query, cached: false, results };
    await this.cache.setJson(cacheKey, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  /**
   * Platform operator search — industries and accounts, not factory stock.
   */
  async searchPlatform(rawQuery: string): Promise<SearchResponse> {
    const query = rawQuery.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (query.length < 2) {
      return { query, cached: false, results: [] };
    }

    const cacheKey = `search:v1:platform:${query.toLowerCase()}`;
    const hit = await this.cache.getJson<SearchResponse>(cacheKey);
    if (hit) {
      return { ...hit, cached: true };
    }

    const pattern = `%${query}%`;
    const [organizations, users] = await Promise.all([
      this.organizations.find({
        where: [
          { name: ILike(pattern) },
          { tin: ILike(pattern) },
          { registrationNumber: ILike(pattern) },
        ],
        take: LIMIT_PER_TYPE,
        order: { name: 'ASC' },
      }),
      this.users.find({
        where: [{ email: ILike(pattern) }, { fullName: ILike(pattern) }],
        take: LIMIT_PER_TYPE,
        order: { email: 'ASC' },
        relations: { organization: true },
      }),
    ]);

    const results: SearchHit[] = [
      ...organizations.map(
        (o): SearchHit => ({
          type: 'organization',
          id: o.id,
          title: o.name,
          subtitle: o.type,
          href:
            o.type === 'REGULATOR'
              ? `/dashboard/regulators`
              : `/dashboard/industries`,
        }),
      ),
      ...users.map(
        (u): SearchHit => ({
          type: 'user',
          id: u.id,
          title: u.fullName ?? u.email,
          subtitle: u.organization?.name ?? u.email,
          href: `/dashboard/users`,
        }),
      ),
    ];

    const payload: SearchResponse = { query, cached: false, results };
    await this.cache.setJson(cacheKey, payload, CACHE_TTL_SECONDS);
    return payload;
  }
}

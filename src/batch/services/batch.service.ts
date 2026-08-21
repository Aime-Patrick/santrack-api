import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  DuplicateException,
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { CreateBatchDto } from '../dto/batch.dto';
import { Batch } from '../entities/batch.entity';
import { BatchStatus } from '../batch-status.enum';

@Injectable()
export class BatchService {
  constructor(
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /**
   * Opens a production lot. The creating organization is recorded as the
   * manufacturer, because only the manufacturer (or a regulator) may later
   * recall it - and that authority has to be established when the lot is made,
   * not claimed afterwards.
   */
  async create(organization: Organization, dto: CreateBatchDto): Promise<Batch> {
    const product = await this.products.findOne({ where: { id: dto.productId } });
    if (!product) {
      throw new NotFoundEntityException('Product', dto.productId);
    }

    const batchCode = dto.batchCode.trim();
    const existing = await this.batches.findOne({
      where: { product: { id: product.id }, batchCode },
    });
    if (existing) {
      throw new DuplicateException(
        `Batch ${batchCode} already exists for ${product.name}`,
      );
    }

    if (dto.manufacturedOn && dto.expiresOn && dto.expiresOn < dto.manufacturedOn) {
      throw new TraceabilityRuleException(
        'A batch cannot expire before it was manufactured',
      );
    }

    return this.batches.save(
      this.batches.create({
        product,
        batchCode,
        manufacturer: organization,
        manufacturedOn: dto.manufacturedOn ?? null,
        expiresOn: dto.expiresOn ?? null,
      }),
    );
  }

  /** Lots this organization manufactured. */
  async list(organization: Organization): Promise<Batch[]> {
    return this.batches.find({
      where: { manufacturer: { id: organization.id } },
      order: { id: 'DESC' },
    });
  }

  /**
   * Every lot of one product, whoever made it. Needed when tracing a problem
   * back across manufacturers rather than looking at your own production.
   */
  async listForProduct(productId: number): Promise<Batch[]> {
    return this.batches.find({
      where: { product: { id: productId } },
      order: { id: 'DESC' },
    });
  }

  async get(batchId: number): Promise<Batch> {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) {
      throw new NotFoundEntityException('Batch', batchId);
    }
    return batch;
  }

  /**
   * Moves a lot to a new status and records the audit trail.
   *
   * The previous status is saved so that a lifted recall can restore the
   * verdict the lot had earned rather than guessing ACTIVE. The reason and
   * timestamp are written here rather than by callers, so every transition
   * goes through the same gate and the columns are never half-populated.
   *
   * Callers inside a transaction must pass their `manager`. The injected
   * repository holds its own connection, so without it the status change
   * commits immediately and survives a rollback that discards the events
   * recorded alongside it - leaving a lot that says APPROVED with no
   * inspection behind it.
   */
  async updateStatus(
    batch: Batch,
    target: BatchStatus,
    reason?: string,
    manager?: EntityManager,
  ): Promise<Batch> {
    batch.previousStatus = batch.status;
    batch.status = target;
    batch.statusReason = reason ?? null;
    batch.statusChangedAt = new Date();
    return manager ? manager.save(Batch, batch) : this.batches.save(batch);
  }
}

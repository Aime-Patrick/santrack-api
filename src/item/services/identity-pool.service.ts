import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { randomUUID } from 'node:crypto';

import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  NotVisibleException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Location } from '../../location/entities/location.entity';
import { ProductionOrder } from '../../manufacturing/entities/production-order.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { permitsIdentityAssignment } from '../../batch/batch-status.enum';
import { Product } from '../../product/entities/product.entity';
import { permitsIdentityPool } from '../../product/traceability-level.enum';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import {
  AssignIdentitiesDto,
  CancelIdentityDto,
  ConfirmProducedDto,
  RequestIdentitiesDto,
} from '../dto/identity-pool.dto';
import { IdentityPool, PoolStatus } from '../entities/identity-pool.entity';
import { TraceableItem } from '../entities/traceable-item.entity';
import {
  CancellationReason,
  ItemKind,
  ItemStatus,
  isPreProduction,
} from '../item.enums';
import { PoolCounts, reconcileCounts } from '../pool-reconciliation';
import { ItemCodeGenerator } from './item-code-generator.service';

/**
 * Identities minted per transaction.
 *
 * The same thousand-row bound the registration path uses, and for the same
 * reason: a transaction holding more than that open is long enough to block
 * other scans. The difference is that a pool is not one transaction - it is a
 * sequence of them - so a request for ten thousand is ten commits rather than
 * a refusal.
 */
const MINT_CHUNK = 1000;

/**
 * The largest pool one request may ask for.
 *
 * Not a technical ceiling; a mistyping one. Ten million codes is not a print
 * run, it is a missing decimal point, and minting it would fill the identity
 * table before anybody noticed.
 */
const MAX_POOL_SIZE = 1_000_000;

/**
 * Identities per UPDATE statement. Same bind-parameter ceiling as the event
 * inserts; see updateIdentities below.
 */
const UPDATE_CHUNK = 1000;

/**
 * Preparing codes for goods that do not exist yet (DR-08).
 *
 * A factory cannot label bottles it has not made, and cannot make bottles
 * without labels, so the codes have to come first. This service mints them
 * into a pool where they sit as GENERATED - printable, scannable, and
 * emphatically not stock. Nothing here puts a code in anyone's inventory; that
 * happens only when production confirms a unit was really made under it.
 */
@Injectable()
export class IdentityPoolService {
  private readonly logger = new Logger(IdentityPoolService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(IdentityPool)
    private readonly pools: Repository<IdentityPool>,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly codeGenerator: ItemCodeGenerator,
    private readonly recorder: EventRecorder,
  ) {}

  /**
   * Accepts the request, then mints in the background.
   *
   * The pool row commits before minting starts, so the caller gets an id to
   * watch immediately and a half-filled pool is still a real, inspectable
   * thing rather than a request that vanished. Ten thousand codes take about a
   * second, but the request does not wait on them: a plant printing a large
   * run should see progress, not a spinner it cannot tell from a timeout.
   */
  async request(
    organization: Organization,
    actor: User,
    dto: RequestIdentitiesDto,
  ): Promise<IdentityPool> {
    const product = await this.products.findOne({ where: { id: dto.productId } });
    if (!product) {
      throw new NotFoundEntityException('Product', dto.productId);
    }

    // Catalogues are scoped to the organization that owns them, so minting
    // against another business's product would put their goods in your pool.
    if (product.organizationId !== organization.id) {
      throw new NotVisibleException(`Product ${dto.productId}`);
    }

    /**
     * A pool is a print run of labels, and every code in it will stand for
     * exactly one unit. Only a SERIAL product means that, so anything else is
     * refused here rather than minted into a shape its catalogue entry
     * contradicts (DR-09 WU-1).
     */
    if (!permitsIdentityPool(product.traceabilityLevel)) {
      throw new TraceabilityRuleException(
        `${product.name} is traced at ${product.traceabilityLevel} level, where one ` +
          'identity stands for more than one unit, so a pool of single-unit codes ' +
          'cannot say what it means. Register its units directly, or change the ' +
          'product to SERIAL traceability first.',
      );
    }

    if (dto.count > MAX_POOL_SIZE) {
      throw new TraceabilityRuleException(
        `${dto.count} identities is beyond the ${MAX_POOL_SIZE} a single pool may ` +
          'hold. Split the run, or check the figure is right.',
      );
    }

    const pool = await this.pools.save(
      this.pools.create({
        organizationId: organization.id,
        product,
        requestedCount: dto.count,
        status: PoolStatus.GENERATING,
        createdBy: actor,
        completedAt: null,
        failureReason: null,
      }),
    );

    // Deliberately not awaited. A failure lands on the pool row, where the
    // screen watching it will see it, so there is nothing for the caller to
    // catch here.
    void this.fill(pool.id, actor).catch((error: unknown) => {
      this.logger.error(`Pool ${pool.id} minting failed: ${String(error)}`);
    });

    return pool;
  }

  /**
   * Mints whatever is still missing from a pool, in committed chunks.
   *
   * Restartable on purpose. Each pass counts what already exists and mints
   * only the gap, so a process that dies half way through ten thousand codes
   * leaves six thousand real, committed identities and a pool that can be
   * filled the rest of the way by calling this again. The alternative - one
   * enormous transaction - would roll those six thousand back and take the
   * labels already printed from them with it.
   */
  async fill(poolId: number, actor: User | null): Promise<IdentityPool> {
    const pool = await this.requirePool(poolId);

    try {
      let minted = await this.mintedCount(poolId);
      while (minted < pool.requestedCount) {
        const size = Math.min(MINT_CHUNK, pool.requestedCount - minted);
        await this.mintChunk(pool, actor, size);
        minted += size;
      }

      pool.status = PoolStatus.READY;
      pool.completedAt = new Date();
      pool.failureReason = null;
    } catch (error: unknown) {
      pool.status = PoolStatus.FAILED;
      pool.failureReason = error instanceof Error ? error.message : String(error);
    }

    return this.pools.save(pool);
  }

  /**
   * One committed batch of identities, written as two multi-row inserts.
   *
   * Saving each identity and its birth event one at a time is two round trips
   * per code - fifty seconds for ten thousand, which is a progress bar nobody
   * believes. Inserting the rows as a set makes it a couple of seconds. The
   * inserts stay inside one transaction, so a chunk either lands whole or not
   * at all and no identity ever exists without the event recording its birth.
   */
  private async mintChunk(
    pool: IdentityPool,
    actor: User | null,
    size: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const codes = await this.codeGenerator.nextCodes(
        manager,
        pool.product.sku,
        size,
      );

      const identities = codes.map((code) =>
        manager.create(TraceableItem, {
          qrCode: randomUUID(),
          code,
          kind: ItemKind.UNIT,
          product: pool.product,
          pool,
          /**
           * The three fields that make this a label rather than a bottle.
           *
           * GENERATED keeps it out of every stock query; a null holder means no
           * business is claiming to have it; a null batch means no lot claims
           * to have produced it. Production confirming the unit sets all three
           * together, or none of them.
           */
          status: ItemStatus.GENERATED,
          holder: null,
          batch: null,
          quantity: 1,
        }),
      );

      // insert() rather than save() because these are all new: save() would
      // issue a SELECT per row first to find out what it already knew.
      const inserted = await manager.insert(TraceableItem, identities);
      identities.forEach((identity, i) => {
        identity.id = inserted.identifiers[i].id as number;
      });

      await this.recorder.recordMany(
        manager,
        identities.map((identity) => ({
          item: identity,
          type: EventType.IDENTITY_GENERATED,
          actor,
          // No source or destination organization: nobody holds this yet.
          // Naming the manufacturer here would be the exact false claim this
          // lifecycle exists to prevent.
          quantity: 1,
        })),
      );
    });
  }

  /**
   * Applies one change to many identities.
   *
   * Chunked for the same reason bulk event inserts are: an UPDATE ... WHERE id
   * IN (...) binds one parameter per id, and Postgres stops at 65,535 of them.
   * A ten thousand bottle run is under that today, but a fifty thousand one is
   * not, and the failure would arrive as a driver error in the middle of
   * confirming a production run.
   */
  private async updateIdentities(
    manager: EntityManager,
    ids: number[],
    change: QueryDeepPartialEntity<TraceableItem>,
  ): Promise<void> {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      await manager.update(TraceableItem, ids.slice(i, i + UPDATE_CHUNK), change);
    }
  }

  // --------------------------------------------------------- act 3: assign

  /**
   * Claims codes from a pool for a production run.
   *
   * A plan, not a product. Assignment exists so that two runs drawing on one
   * pool cannot both claim the same code, and so the line knows which codes it
   * is about to print. The identities move GENERATED -> ASSIGNED and pick up
   * the run's lot, which is where their expiry date will come from - but they
   * stay out of stock, unheld, and unsellable, because nothing has been made.
   *
   * The lot is attached now rather than at confirmation because a code stuck
   * on a bottle belongs to that run from the moment it is applied. If the run
   * is later abandoned the codes are cancelled, not silently returned to the
   * pool: labels that went out to the line cannot be un-printed.
   */
  async assign(
    organization: Organization,
    actor: User,
    dto: AssignIdentitiesDto,
  ): Promise<AssignmentResult> {
    return this.dataSource.transaction(async (manager) => {
      const pool = await this.requirePool(dto.poolId, manager);
      if (pool.organizationId !== organization.id) {
        throw new NotVisibleException(`IdentityPool ${dto.poolId}`);
      }

      const order = await manager.findOne(ProductionOrder, {
        where: { id: dto.productionOrderId },
        relations: { batch: true, product: true, organization: true },
      });
      if (!order) {
        throw new NotFoundEntityException('ProductionOrder', dto.productionOrderId);
      }
      if (order.organization.id !== organization.id) {
        throw new NotVisibleException(`ProductionOrder ${dto.productionOrderId}`);
      }

      // Codes for one product cannot label another. This is the check that
      // stops a mispicked pool putting Akagera Water labels on a run of juice.
      if (order.product.id !== pool.product.id) {
        throw new TraceabilityRuleException(
          `Pool ${pool.id} holds codes for ${pool.product.name}, but order ` +
            `${order.orderNumber} produces ${order.product.name}`,
        );
      }

      if (!order.batch) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} has no lot, so there is nothing for these ` +
            'codes to belong to',
        );
      }

      const available = await manager.find(TraceableItem, {
        where: { pool: { id: pool.id }, status: ItemStatus.GENERATED },
        order: { id: 'ASC' },
        take: dto.count ?? undefined,
      });

      if (available.length === 0) {
        throw new TraceabilityRuleException(
          `Pool ${pool.id} has no unassigned codes left`,
        );
      }
      if (dto.count && available.length < dto.count) {
        throw new TraceabilityRuleException(
          `Pool ${pool.id} has ${available.length} unassigned codes, fewer than ` +
            `the ${dto.count} requested`,
        );
      }

      const ids = available.map((identity) => identity.id);
      await this.updateIdentities(manager, ids, {
        status: ItemStatus.ASSIGNED,
        batch: { id: order.batch.id },
        // The lot's shelf date, copied so expiry checks need no join - the
        // same thing registration has always done.
        expiresOn: order.batch.expiresOn ?? null,
      });

      await this.recorder.recordMany(
        manager,
        available.map((identity) => ({
          item: identity,
          type: EventType.IDENTITY_ASSIGNED,
          actor,
          quantity: 1,
          notes: `Claimed by ${order.orderNumber}`,
        })),
      );

      return {
        poolId: pool.id,
        productionOrderId: order.id,
        orderNumber: order.orderNumber,
        assigned: available.length,
        firstCode: available[0].code,
        lastCode: available[available.length - 1].code,
      };
    });
  }

  // -------------------------------------------------------- act 4: confirm

  /**
   * The moment codes become products.
   *
   * Everything still ASSIGNED to this run is what the line actually made,
   * because every code that failed was cancelled as it failed. So the count is
   * derived rather than typed: a figure computed from what happened cannot be
   * mistyped, and a figure typed at the end of a long shift frequently is.
   *
   * This is where MANUFACTURED is written. It used to be written the instant
   * an identity row was created, which said a bottle existed at the moment a
   * code was minted - the false claim this whole lifecycle was built to
   * remove.
   */
  async confirmProduced(
    organization: Organization,
    actor: User,
    dto: ConfirmProducedDto,
  ): Promise<ConfirmationResult> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(ProductionOrder, {
        where: { id: dto.productionOrderId },
        relations: { batch: true, product: true, organization: true },
      });
      if (!order) {
        throw new NotFoundEntityException('ProductionOrder', dto.productionOrderId);
      }
      if (order.organization.id !== organization.id) {
        throw new NotVisibleException(`ProductionOrder ${dto.productionOrderId}`);
      }
      if (!order.batch) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} has no lot`,
        );
      }

      /**
       * The existing gate, unchanged: only an approved or active lot may
       * acquire identities. Quality control has to have had its say before a
       * code is allowed to mean a saleable bottle.
       */
      if (!permitsIdentityAssignment(order.batch.status)) {
        throw new TraceabilityRuleException(
          `Lot ${order.batch.batchCode} is ${order.batch.status} — only APPROVED ` +
            'or ACTIVE lots may have identities confirmed against them',
        );
      }

      const location = dto.locationId
        ? await manager.findOne(Location, { where: { id: dto.locationId } })
        : null;
      if (dto.locationId && !location) {
        throw new NotFoundEntityException('Location', dto.locationId);
      }

      const waiting = await manager.find(TraceableItem, {
        where: { batch: { id: order.batch.id }, status: ItemStatus.ASSIGNED },
        order: { id: 'ASC' },
      });

      if (waiting.length === 0) {
        throw new TraceabilityRuleException(
          `No codes are assigned to ${order.orderNumber}, so there is nothing to ` +
            'confirm. Assign a pool to the order first.',
        );
      }

      if (dto.count && dto.count > waiting.length) {
        throw new TraceabilityRuleException(
          `${dto.count} confirmed exceeds the ${waiting.length} codes assigned to ` +
            `${order.orderNumber}. A run cannot produce more units than it has labels.`,
        );
      }

      const confirming = dto.count ? waiting.slice(0, dto.count) : waiting;
      const stillWaiting = waiting.length - confirming.length;

      const ids = confirming.map((identity) => identity.id);
      await this.updateIdentities(manager, ids, {
        status: ItemStatus.ACTIVE,
        holder: { id: organization.id },
        location: location ? { id: location.id } : null,
      });

      await this.recorder.recordMany(
        manager,
        confirming.map((identity) => ({
          item: identity,
          type: EventType.MANUFACTURED,
          actor,
          destinationOrganization: organization,
          destinationLocation: location,
          quantity: 1,
        })),
      );

      /**
       * The order's produced quantity, set from what was confirmed rather than
       * from what somebody said. Registration used to check a typed figure
       * against the identities; now the identities are the figure.
       */
      order.producedQuantity = confirming.length;
      await manager.save(ProductionOrder, order);

      return {
        productionOrderId: order.id,
        orderNumber: order.orderNumber,
        confirmed: confirming.length,
        /**
         * Assigned codes not confirmed by this call. Reported rather than
         * cancelled: the system does not know whether those labels are on
         * bottles nobody counted or lying in a bin, and guessing either way
         * writes a fact nobody established.
         */
        stillAwaitingProduction: stillWaiting,
      };
    });
  }

  // --------------------------------------------------------- acts 5 and 6

  /**
   * Ends codes that will never name a product.
   *
   * The bottle broke on the line, or the label was never used. Both are the
   * same lifecycle exit with different reasons, and neither deletes anything:
   * the row survives so that a scan of that code in a shop, years later,
   * answers "cancelled during production on this date" instead of "unknown
   * code". The second answer invites the person holding it to conclude the
   * system is broken rather than the bottle invalid.
   *
   * Only a code that has not yet become a product may be cancelled. A bottle
   * that was really made and then broke is DAMAGED or DESTROYED, which is a
   * different fact about a different thing, and the yield report needs to tell
   * them apart.
   */
  async cancel(
    organization: Organization,
    actor: User,
    codes: string[],
    dto: CancelIdentityDto,
  ): Promise<CancellationResult> {
    if (codes.length === 0) {
      throw new TraceabilityRuleException('Scan at least one code to cancel');
    }

    return this.dataSource.transaction(async (manager) => {
      const identities = await manager.find(TraceableItem, {
        where: [{ code: In(codes) }, { qrCode: In(codes) }],
        relations: { pool: true },
      });

      const found = new Set(identities.flatMap((i) => [i.code, i.qrCode]));
      const unknown = codes.filter((code) => !found.has(code));

      for (const identity of identities) {
        if (identity.pool?.organizationId !== organization.id) {
          throw new NotVisibleException(identity.code);
        }
        if (!isPreProduction(identity.status)) {
          throw new TraceabilityRuleException(
            `${identity.code} is ${identity.status}. Only a code that has not yet ` +
              'become a product can be cancelled — a unit that was made and then ' +
              'failed is damaged or destroyed, which is a different thing.',
          );
        }
      }

      const cancelledAt = new Date();
      await this.updateIdentities(
        manager,
        identities.map((i) => i.id),
        {
          status: ItemStatus.CANCELLED,
          cancellationReason: dto.reason,
          cancelledAt,
          cancelledBy: { id: actor.id },
        },
      );

      await this.recorder.recordMany(
        manager,
        identities.map((identity) => ({
          item: identity,
          type: EventType.IDENTITY_CANCELLED,
          actor,
          quantity: 1,
          notes: dto.notes ?? dto.reason,
        })),
      );

      return {
        cancelled: identities.length,
        reason: dto.reason,
        codes: identities.map((i) => i.code),
        // Reported, not thrown: an operator scanning a stack of failed labels
        // should be told which one did not register, not have the whole batch
        // refused.
        unknown,
      };
    });
  }

  // ------------------------------------------------------------ reporting

  /** How many identities this pool has actually minted so far. */
  async mintedCount(poolId: number): Promise<number> {
    return this.items.count({ where: { pool: { id: poolId } } });
  }

  /**
   * What became of a pool's codes.
   *
   * The figures a yield report and a supervisor both want, counted from the
   * identities rather than stored, so they cannot disagree with the rows they
   * describe. `unminted` and `unaccounted` should be zero on a finished pool;
   * they are returned rather than asserted so a discrepancy appears on the
   * screen instead of throwing in the middle of a production run.
   */
  async reconcile(poolId: number): Promise<PoolReconciliation> {
    const pool = await this.requirePool(poolId);

    const rows: Array<{ status: ItemStatus; count: string }> = await this.items
      .createQueryBuilder('i')
      .select('i.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('i.pool_id = :poolId', { poolId })
      .groupBy('i.status')
      .getRawMany();

    const byStatus = new Map<ItemStatus, number>();
    for (const row of rows) {
      byStatus.set(row.status, Number(row.count));
    }

    return {
      poolId: pool.id,
      productName: pool.product.name,
      status: pool.status,
      ...reconcileCounts(pool.requestedCount, byStatus),
      byStatus: [...byStatus.entries()].map(([status, count]) => ({
        status,
        count,
      })),
    };
  }

  async requirePool(poolId: number, manager?: EntityManager): Promise<IdentityPool> {
    const repo = manager ? manager.getRepository(IdentityPool) : this.pools;
    const pool = await repo.findOne({ where: { id: poolId } });
    if (!pool) {
      throw new NotFoundEntityException('IdentityPool', poolId);
    }
    return pool;
  }

  /** The pool, refused if it belongs to somebody else. */
  async requireOwnedPool(
    poolId: number,
    organization: Organization,
  ): Promise<IdentityPool> {
    const pool = await this.requirePool(poolId);
    if (pool.organizationId !== organization.id) {
      throw new NotVisibleException(`IdentityPool ${poolId}`);
    }
    return pool;
  }

  /** Pools this organization has requested, newest first. */
  async listFor(
    organization: Organization,
    productId: number | undefined,
    page: number,
    size: number,
  ): Promise<{
    content: IdentityPool[];
    total: number;
    page: number;
    size: number;
  }> {
    const where: Record<string, unknown> = { organizationId: organization.id };
    if (productId) {
      where.product = { id: productId };
    }

    const [content, total] = await this.pools.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  /** Export all serial codes and QR payloads in this pool as CSV. */
  async exportCodes(
    poolId: number,
    organization: Organization,
  ): Promise<{ filename: string; csv: string }> {
    const pool = await this.requireOwnedPool(poolId, organization);
    const items = await this.items.find({
      where: { pool: { id: pool.id } },
      relations: ['product', 'batch'],
      order: { id: 'ASC' },
    });

    const headers = ['Serial Code', 'QR Payload / URL', 'Status', 'Product Name', 'SKU', 'Batch Code', 'Created At'];
    const rows = items.map((item) => [
      item.code,
      item.qrCode,
      item.status,
      pool.product?.name ?? '',
      pool.product?.sku ?? '',
      item.batch?.batchCode ?? '',
      item.createdAt ? item.createdAt.toISOString() : '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const filename = `pool-${pool.id}-${pool.product?.sku || 'codes'}.csv`;
    return { filename, csv };
  }
}

export interface PoolReconciliation extends PoolCounts {
  poolId: number;
  productName: string;
  status: PoolStatus;
  /** The same figures split by the exact status, for the detail table. */
  byStatus: Array<{ status: ItemStatus; count: number }>;
}

/** What one assignment claimed. */
export interface AssignmentResult {
  poolId: number;
  productionOrderId: number;
  orderNumber: string;
  assigned: number;
  /** The range that went to the line, so the print job can be checked. */
  firstCode: string;
  lastCode: string;
}

/** What one production confirmation turned into product. */
export interface ConfirmationResult {
  productionOrderId: number;
  orderNumber: string;
  confirmed: number;
  /** Assigned codes this call did not confirm. Zero on a closed run. */
  stillAwaitingProduction: number;
}

/** What one cancellation ended. */
export interface CancellationResult {
  cancelled: number;
  reason: CancellationReason;
  codes: string[];
  /** Scanned codes this platform has never issued. */
  unknown: string[];
}

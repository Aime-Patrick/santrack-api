import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { User } from '../../auth/entities/user.entity';
import {
  ItemNotFoundException,
  NotFoundEntityException,
  NotVisibleException,
  TraceabilityRuleException,
} from '../../common/errors';
import { permitsIdentityAssignment } from '../../batch/batch-status.enum';
import { Batch } from '../../batch/entities/batch.entity';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { TraceabilityLevel } from '../../product/traceability-level.enum';
import { ProductionOrder } from '../../manufacturing/entities/production-order.entity';
import { TraceabilityEvent } from '../../traceability/entities/traceability-event.entity';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { TraceableItem } from '../entities/traceable-item.entity';
import {
  ItemKind,
  ItemStatus,
  NON_PHYSICAL_STATUSES,
  SealState,
  isTerminal,
} from '../item.enums';
import { ItemCodeGenerator } from './item-code-generator.service';
import { PackDto, RegisterPackageDto, RegisterUnitsDto, RemoveUnitDto, ScanDto } from '../dto/item.dto';

/**
 * Identities one request may mint. The cost is rows written inside a single
 * transaction, not units represented.
 */
const MAX_IDENTITIES_PER_REQUEST = 1000;

/**
 * The identity registry and the packaging hierarchy: creating permanent QR
 * identities, putting them inside containers, opening those containers and
 * taking things back out. Every operation here appends to the event log rather
 * than only mutating current state.
 */
@Injectable()
export class ItemService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(TraceabilityEvent)
    private readonly events: Repository<TraceabilityEvent>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly codeGenerator: ItemCodeGenerator,
    private readonly recorder: EventRecorder,
  ) {}

  // ------------------------------------------------------------- lookup

  /**
   * Resolves a scan. Accepts the QR payload, the printed code, a
   * manufacturer barcode (GTIN), or a product SKU — in which case the first
   * produced item of the matching product is returned.
   *
   * The GTIN and SKU fallbacks skip identities that name nothing physical
   * (DR-08). Without that they would return the lowest-numbered row for the
   * product, which since pools exist is a freshly minted label from a print
   * run rather than a bottle on a shelf — so scanning a barcode in a warehouse
   * full of stock would resolve to a code for a bottle nobody has made.
   */
  async require(qrCode: string, manager?: EntityManager): Promise<TraceableItem> {
    const repo = manager ? manager.getRepository(TraceableItem) : this.items;
    const scanRelations = { parent: true, pool: true } as const;

    const item =
      (await repo.findOne({ where: { qrCode }, relations: scanRelations })) ??
      (await repo.findOne({ where: { code: qrCode }, relations: scanRelations }));
    if (item) return item;

    // 3. Try product GTIN (manufacturer barcode)
    const productByGtin = await this.products.findOne({ where: { gtin: qrCode } });
    if (productByGtin) {
      const itemByGtin = await repo.findOne({
        where: {
          product: { id: productByGtin.id },
          status: Not(In(NON_PHYSICAL_STATUSES as ItemStatus[])),
        },
        relations: scanRelations,
        order: { id: 'ASC' },
      });
      if (itemByGtin) return itemByGtin;

      await this.rejectProductBarcodeAsIdentity(
        qrCode,
        productByGtin.id,
        productByGtin.sku,
        'GTIN',
        repo,
      );
    }

    // 4. Try product SKU
    const productBySku = await this.products.findOne({ where: { sku: qrCode } });
    if (productBySku) {
      const itemBySku = await repo.findOne({
        where: {
          product: { id: productBySku.id },
          status: Not(In(NON_PHYSICAL_STATUSES as ItemStatus[])),
        },
        relations: scanRelations,
        order: { id: 'ASC' },
      });
      if (itemBySku) return itemBySku;

      await this.rejectProductBarcodeAsIdentity(
        qrCode,
        productBySku.id,
        productBySku.sku,
        'SKU',
        repo,
      );
    }

    throw new ItemNotFoundException(qrCode);
  }

  /**
   * Scanned value matched a product catalogue code, but not a physical stock
   * identity. Pool labels encode the UUID (or serial ST-…), not the product SKU.
   */
  private async rejectProductBarcodeAsIdentity(
    scanned: string,
    productId: number,
    sku: string,
    kind: 'SKU' | 'GTIN',
    repo: Repository<TraceableItem>,
  ): Promise<never> {
    const sample = await repo.findOne({
      where: { product: { id: productId } },
      order: { id: 'ASC' },
    });

    if (sample) {
      throw new TraceabilityRuleException(
        `${scanned} is the product ${kind}, not a pool identity. ` +
          `Scan the QR from the pool export (payload is a UUID) or type the serial ` +
          `(e.g. ${sample.code}). Pool labels are not sellable until production ` +
          `confirms them as ACTIVE stock.`,
      );
    }

    throw new TraceabilityRuleException(
      `${scanned} is product ${kind} ${sku}, but no identities exist yet. ` +
        `Mint a pool and print those QRs, then confirm production before selling.`,
    );
  }

  /**
   * Whether an organization may see this identity at all.
   *
   * Holding it is the obvious case. Having handled it is the other: a
   * manufacturer must be able to trace what it made after it has been sold on,
   * and a shop must still see what it sold. Anyone who never touched the
   * product sees nothing - organizational data stays isolated (proposal
   * section 25) without breaking traceability (section 9).
   *
   * Owning the minting pool also counts: GENERATED / ASSIGNED labels have no
   * holder yet, but the manufacturer that printed them must still resolve a
   * scan of their own pool QR.
   */
  async maySee(item: TraceableItem, organization: Organization): Promise<boolean> {
    if (organization.type === 'REGULATOR') {
      return true;
    }
    if (item.holder?.id === organization.id) {
      return true;
    }
    if (item.pool?.organizationId === organization.id) {
      return true;
    }

    // Containers this item travelled inside count as part of its own history.
    const ids = [item.id, ...(await this.carrierIds(item))];
    const handled = await this.events
      .createQueryBuilder('e')
      .where('e.item_id IN (:...ids)', { ids })
      .andWhere(
        '(e.source_organization_id = :org OR e.destination_organization_id = :org)',
        { org: organization.id },
      )
      .limit(1)
      .getCount();

    return handled > 0;
  }

  /**
   * The item this code names, and only that - no guessing.
   *
   * `require` above deliberately falls back to a product's GTIN or SKU and
   * hands back the first item of that product. That is a convenience with a
   * sharp edge: scanning the barcode printed on a pack identifies the *kind*
   * of thing, not the one in your hand, so the fallback returns an arbitrary
   * unit. For an operation that then dispatches, quarantines or sells it, that
   * is the wrong unit moving through the chain of custody under a code nobody
   * scanned.
   *
   * Anything that has to tell one code apart from another - the scan resolver
   * above all - asks this instead, and treats a product barcode as a product.
   */
  async findByIdentity(code: string): Promise<TraceableItem | null> {
    const trimmed = code.trim();
    if (!trimmed) return null;

    return (
      (await this.items.findOne({
        where: { qrCode: trimmed },
        relations: { parent: true, pool: true },
      })) ??
      (await this.items.findOne({
        where: { code: trimmed },
        relations: { parent: true, pool: true },
      }))
    );
  }

  /** Resolves a scan and refuses if the caller has no part in its history. */
  async requireVisible(
    qrCode: string,
    organization: Organization,
  ): Promise<TraceableItem> {
    const item = await this.require(qrCode);
    if (!(await this.maySee(item, organization))) {
      // Reported as not-found: confirming existence would leak that some other
      // organization holds a product under this code.
      throw new NotVisibleException(qrCode);
    }
    return item;
  }

  async listHeld(
    organization: Organization,
    kind: ItemKind | undefined,
    topLevelOnly: boolean,
    page: number,
    size: number,
    productId?: number,
  ): Promise<{ content: TraceableItem[]; total: number; page: number; size: number }> {
    const where: Record<string, unknown> = { holder: { id: organization.id } };
    if (kind) {
      where.kind = kind;
    }
    if (topLevelOnly) {
      where.parent = IsNull();
    }
    if (productId) {
      where.product = { id: productId };
    }

    const [content, total] = await this.items.findAndCount({
      where,
      relations: { parent: true, product: true, location: true },
      order: { id: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  /**
   * What is in a container now, and what has left it. Removed units are
   * recovered from the event log, since removal clears the parent link but
   * never erases the history (business rule 9).
   */
  async contents(container: TraceableItem): Promise<{
    container: TraceableItem;
    present: TraceableItem[];
    removed: TraceableItem[];
  }> {
    requirePackage(container);

    const present = await this.items.find({
      where: { parent: { id: container.id } },
      relations: { parent: true },
    });

    const removalEvents = await this.events.find({
      where: { relatedItem: { id: container.id }, type: EventType.UNIT_REMOVED },
      relations: { item: true },
      order: { occurredAt: 'ASC' },
    });

    // A unit removed and later re-packed is present, not removed. The event
    // log records both facts; current state decides which one is true now.
    const presentIds = new Set(present.map((i) => i.id));
    const removed = removalEvents
      .map((e) => e.item)
      // UNIT_REMOVED always names an item; the narrowing is for the batch-level
      // events that now share this table and never reach this query.
      .filter((i): i is TraceableItem => i !== null && !presentIds.has(i.id));

    return { container, present, removed };
  }

  // ----------------------------------------------------------- registry

  /**
   * Mints identities for newly manufactured units. This is the only place a
   * unit identity comes into existence, which is what makes rule 2 - never
   * silently reuse an identity - enforceable.
   *
   * When a batch is provided, two gates apply:
   *  1. The lot must be APPROVED or ACTIVE — a lot that is pending QC,
   *     rejected, reworked, quarantined, recalled or closed must not acquire
   *     the identities that say the platform vouches for its quality.
   *  2. The cumulative number of registered identities must not exceed the
   *     produced quantity on the production order that owns the batch.
   *     Packages do not consume the product quota: 1,000 laptops in 100
   *     boxes = 1,000 product identities, not 1,100.
   */
  async registerUnits(
    organization: Organization,
    actor: User,
    dto: RegisterUnitsDto,
  ): Promise<TraceableItem[]> {
    await this.recorder.rejectReplay(dto.meta);

    return this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(Product, { where: { id: dto.productId } });
      if (!product) {
        throw new NotFoundEntityException('Product', dto.productId);
      }

      const batch = dto.batchId
        ? await requireOwnedBatch(manager, organization, dto.batchId)
        : null;
      if (batch && batch.product.id !== product.id) {
        throw new TraceabilityRuleException(
          `Batch ${batch.batchCode} belongs to a different product`,
        );
      }

      if (batch) {
        // Gate 1: only an APPROVED or ACTIVE lot may acquire identities.
        if (!permitsIdentityAssignment(batch.status)) {
          throw new TraceabilityRuleException(
            `Batch ${batch.batchCode} is ${batch.status} — only APPROVED or ACTIVE ` +
              'lots may have identities registered against them',
          );
        }

        /**
         * Gate 2: cumulative cap. The total number of *units* registered
         * against a batch cannot exceed the produced quantity on the order.
         *
         * Sums quantity rather than counting rows. Counting identities was
         * correct only while every identity stood for exactly one unit; under
         * BATCH traceability a single identity carries the whole lot, and a row
         * count would compare 1 against a produced quantity of 10,000 and wave
         * through nine thousand phantom units (DR-01).
         */
        const order = await manager.findOne(ProductionOrder, {
          where: { batch: { id: batch.id } },
        });
        if (order) {
          const alreadyRegistered = await registeredUnits(manager, batch.id);
          if (alreadyRegistered + dto.count > order.producedQuantity) {
            throw new TraceabilityRuleException(
              `Batch ${batch.batchCode}: ${alreadyRegistered} units already registered + ` +
                `${dto.count} requested exceeds produced quantity of ${order.producedQuantity}`,
            );
          }
        }
      }

      const location = dto.locationId
        ? await requireOwnedLocation(manager, organization, dto.locationId)
        : null;

      const serials = dto.serialNumbers ?? [];

      /**
       * How the requested quantity is split into identities (DR-01).
       *
       * `dto.count` has always meant physical units. What changes with the
       * traceability level is how many identities carry them: one each under
       * SERIAL, one per pack under PACKAGE, and a single identity for the whole
       * lot under BATCH. `quantity` is the existing "units this identity
       * represents" column doing the job it was documented for.
       */
      const shares = unitsPerIdentity(product, dto);

      /**
       * The transaction-size limit, applied to what actually costs anything.
       *
       * A thousand rows written in one transaction is what holds it open long
       * enough to block other scans; the number of units those rows stand for
       * costs nothing. So a serial run of 10,000 is still split across requests,
       * while a batch-traced lot of 10,000 is one row and goes through.
       */
      if (shares.length > MAX_IDENTITIES_PER_REQUEST) {
        throw new TraceabilityRuleException(
          `${dto.count} units at ${product.traceabilityLevel} traceability would mint ` +
            `${shares.length} identities in one request. Register at most ` +
            `${MAX_IDENTITIES_PER_REQUEST} at a time.`,
        );
      }

      const codes = await this.codeGenerator.nextCodes(
        manager,
        product.sku,
        shares.length,
      );

      const created: TraceableItem[] = [];
      for (let i = 0; i < shares.length; i++) {
        const unit = manager.create(TraceableItem, {
          qrCode: randomUUID(),
          code: codes[i],
          kind: ItemKind.UNIT,
          product,
          batch,
          // A serial belongs to one physical thing. An identity standing for
          // many units is not a serial, so it carries none.
          serialNumber: shares[i] === 1 ? (serials[i] ?? null) : null,
          quantity: shares[i],
          status: ItemStatus.ACTIVE,
          expiresOn: batch?.expiresOn ?? null,
          holder: organization,
          location,
        });
        await manager.save(TraceableItem, unit);

        await this.recorder.record(manager, {
          item: unit,
          type: EventType.MANUFACTURED,
          actor,
          // The client event id identifies the operation, not each unit, so it
          // is carried by the first event of the batch only.
          meta: i === 0 ? dto.meta : null,
          destinationOrganization: organization,
          destinationLocation: location,
          quantity: shares[i],
        });

        created.push(unit);
      }
      return created;
    });
  }

  /**
   * Mints the identity of a physical container. It starts SEALED and empty;
   * contents are attached by pack().
   */
  async registerPackage(
    organization: Organization,
    actor: User,
    dto: RegisterPackageDto,
  ): Promise<TraceableItem> {
    await this.recorder.rejectReplay(dto.meta);

    return this.dataSource.transaction(async (manager) => {
      const product = dto.productId
        ? await manager.findOne(Product, { where: { id: dto.productId } })
        : null;
      if (dto.productId && !product) {
        throw new NotFoundEntityException('Product', dto.productId);
      }

      const batch = dto.batchId
        ? await requirePackageableBatch(manager, organization, dto.batchId)
        : null;
      const location = dto.locationId
        ? await requireOwnedLocation(manager, organization, dto.locationId)
        : null;

      const code = await this.codeGenerator.nextCode(manager, dto.packageType);

      const container = manager.create(TraceableItem, {
        qrCode: randomUUID(),
        code,
        kind: ItemKind.PACKAGE,
        packageType: dto.packageType,
        product,
        batch,
        quantity: 0,
        status: ItemStatus.ACTIVE,
        sealState: SealState.SEALED,
        expiresOn: batch?.expiresOn ?? null,
        holder: organization,
        location,
      });
      await manager.save(TraceableItem, container);

      await this.recorder.record(manager, {
        item: container,
        type: EventType.PACKAGE_CREATED,
        actor,
        meta: dto.meta,
        destinationOrganization: organization,
        destinationLocation: location,
      });

      return container;
    });
  }

  // ---------------------------------------------------------- packaging

  /**
   * Places scanned items inside a container. Children follow the container's
   * location, and an item can only ever sit in one container at a time
   * (business rule 10).
   */
  async pack(
    organization: Organization,
    actor: User,
    containerQr: string,
    dto: PackDto,
  ): Promise<TraceableItem> {
    await this.recorder.rejectReplay(dto.meta);

    return this.dataSource.transaction(async (manager) => {
      const container = await this.require(containerQr, manager);
      requirePackage(container);
      requireHeldBy(container, organization);
      requireOperable(container);

      if (container.sealState === SealState.EMPTY) {
        container.sealState = SealState.OPEN;
      }

      let first = true;
      for (const childQr of dto.childQrCodes) {
        const child = await this.require(childQr, manager);
        requireHeldBy(child, organization);
        requireOperable(child);

        if (child.id === container.id) {
          throw new TraceabilityRuleException('A container cannot contain itself');
        }
        if (child.parent) {
          throw new TraceabilityRuleException(
            `${child.code} is already inside ${child.parent.code} - remove it first`,
          );
        }
        if (child.isPackage() && (await this.isAncestor(manager, child, container))) {
          throw new TraceabilityRuleException(
            `Packing ${child.code} into ${container.code} would create a containment loop`,
          );
        }

        child.parent = container;
        child.location = container.location;
        child.holder = container.holder;
        await manager.save(TraceableItem, child);

        await this.recorder.record(manager, {
          item: child,
          type: EventType.PACKAGED,
          actor,
          meta: first ? dto.meta : null,
          relatedItem: container,
          destinationOrganization: organization,
          destinationLocation: container.location,
          quantity: child.quantity,
        });

        first = false;
      }

      await this.refreshQuantities(manager, container);
      return this.require(container.qrCode, manager);
    });
  }

  /**
   * Opens a container. Its identity and its history survive - only the seal
   * state changes (business rule 8).
   */
  async open(
    organization: Organization,
    actor: User,
    containerQr: string,
    dto?: ScanDto,
  ): Promise<TraceableItem> {
    await this.recorder.rejectReplay(dto?.meta);

    return this.dataSource.transaction(async (manager) => {
      const container = await this.require(containerQr, manager);
      requirePackage(container);
      requireHeldBy(container, organization);
      requireOperable(container);

      if (container.sealState === SealState.OPEN) {
        return container;
      }

      container.sealState = SealState.OPEN;
      await manager.save(TraceableItem, container);

      await this.recorder.record(manager, {
        item: container,
        type: EventType.PACKAGE_OPENED,
        actor,
        meta: dto?.meta,
        sourceOrganization: organization,
        sourceLocation: container.location,
        notes: dto?.notes ?? null,
      });

      return container;
    });
  }

  /**
   * Takes one item out of its container. The container stays on record, the
   * removed item keeps its identity, and both keep their history.
   */
  async removeUnit(
    organization: Organization,
    actor: User,
    containerQr: string,
    dto: RemoveUnitDto,
  ): Promise<TraceableItem> {
    await this.recorder.rejectReplay(dto.meta);

    return this.dataSource.transaction(async (manager) => {
      const container = await this.require(containerQr, manager);
      requirePackage(container);
      requireHeldBy(container, organization);
      requireOperable(container);

      const child = await this.require(dto.childQrCode, manager);
      if (child.parent?.id !== container.id) {
        throw new TraceabilityRuleException(
          `${child.code} is not inside ${container.code}`,
        );
      }

      // Taking something out implies the container was opened, so record that
      // transition rather than leaving a sealed package with missing contents.
      if (container.sealState === SealState.SEALED) {
        container.sealState = SealState.OPEN;
        await manager.save(TraceableItem, container);
        await this.recorder.record(manager, {
          item: container,
          type: EventType.PACKAGE_OPENED,
          actor,
          sourceOrganization: organization,
          sourceLocation: container.location,
        });
      }

      child.parent = null;
      await manager.save(TraceableItem, child);

      await this.recorder.record(manager, {
        item: child,
        type: EventType.UNIT_REMOVED,
        actor,
        meta: dto.meta,
        relatedItem: container,
        sourceOrganization: organization,
        sourceLocation: container.location,
        quantity: child.quantity,
      });

      await this.refreshQuantities(manager, container);

      const remaining = await manager.count(TraceableItem, {
        where: { parent: { id: container.id } },
      });
      if (remaining === 0) {
        container.sealState = SealState.EMPTY;
        await manager.save(TraceableItem, container);
      }

      return this.require(container.qrCode, manager);
    });
  }

  // ------------------------------------------------------------- shared

  /**
   * The item plus everything nested inside it. Custody changes apply to the
   * whole tree, so transferring a sealed pallet moves every unit within it.
   */
  async withDescendants(
    manager: EntityManager,
    root: TraceableItem,
  ): Promise<TraceableItem[]> {
    const all: TraceableItem[] = [];
    const pending: TraceableItem[] = [root];

    while (pending.length > 0) {
      const current = pending.pop() as TraceableItem;
      all.push(current);
      const children = await manager.find(TraceableItem, {
        where: { parent: { id: current.id } },
        relations: { parent: true },
      });
      pending.push(...children);
    }
    return all;
  }

  /** Every container this item currently sits inside, innermost first. */
  private async carrierIds(item: TraceableItem): Promise<number[]> {
    const ids = new Set<number>();

    // Containers it has ever been inside, recovered from its own PACKAGED
    // events. Walking only the current parent chain is not enough: removing a
    // unit clears the link but not the history (business rule 9), so a
    // warehouse that received and forwarded the box - and never handled the
    // loose unit - would drop out of that unit's history the moment a shop
    // opened the box. It handled the goods; it keeps the visibility.
    const packedInto = await this.events.find({
      where: { item: { id: item.id }, type: EventType.PACKAGED },
      relations: { relatedItem: true },
    });
    for (const event of packedInto) {
      if (event.relatedItem) {
        ids.add(event.relatedItem.id);
      }
    }

    let cursor = item.parent;
    while (cursor) {
      ids.add(cursor.id);
      cursor = await this.items
        .findOne({ where: { id: cursor.id }, relations: { parent: true } })
        .then((found) => found?.parent ?? null);
    }

    ids.delete(item.id);
    return [...ids];
  }

  /**
   * Recomputes a container's unit count, then every container above it.
   *
   * Walking upward matters: with a pallet holding boxes holding units,
   * removing one unit changes the box AND the pallet. Inventory counts only
   * top-level identities, so a stale pallet total is a wrong stock figure
   * (business rule 4).
   */
  async refreshQuantities(
    manager: EntityManager,
    from: TraceableItem | null,
  ): Promise<void> {
    let cursor: TraceableItem | null = from;
    const seen = new Set<number>();

    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);

      const children = await manager.find(TraceableItem, {
        where: { parent: { id: cursor.id } },
      });
      const total = children.reduce((sum, child) => sum + child.quantity, 0);

      if (cursor.isPackage()) {
        cursor.quantity = total;
        await manager.save(TraceableItem, cursor);
      }

      const reloaded: TraceableItem | null = await manager.findOne(TraceableItem, {
        where: { id: cursor.id },
        relations: { parent: true },
      });
      cursor = reloaded?.parent ?? null;
    }
  }

  /** True when `candidate` sits anywhere above `item` in the tree. */
  private async isAncestor(
    manager: EntityManager,
    candidate: TraceableItem,
    item: TraceableItem,
  ): Promise<boolean> {
    let cursor: TraceableItem | null = item;
    while (cursor) {
      if (cursor.id === candidate.id) {
        return true;
      }
      const reloaded: TraceableItem | null = await manager.findOne(TraceableItem, {
        where: { id: cursor.id },
        relations: { parent: true },
      });
      cursor = reloaded?.parent ?? null;
    }
    return false;
  }

  /**
   * Whether anything inside this tree is blocked. A sealed box whose contents
   * were recalled must not sell just because the box itself carries no batch -
   * the recall reaches the units, and the units are what the customer gets.
   */
  async findBlockedDescendant(
    manager: EntityManager,
    root: TraceableItem,
    blocked: (item: TraceableItem) => boolean,
  ): Promise<TraceableItem | null> {
    const all = await this.withDescendants(manager, root);
    return all.find((member) => member.id !== root.id && blocked(member)) ?? null;
  }
}

// ------------------------------------------------------------- helpers

export function requirePackage(item: TraceableItem): void {
  if (!item.isPackage()) {
    throw new TraceabilityRuleException(`${item.code} is a unit, not a container`);
  }
}

export function requireHeldBy(item: TraceableItem, organization: Organization): void {
  if (!item.holder || item.holder.id !== organization.id) {
    const holder = item.holder ? item.holder.name : 'no one';
    throw new TraceabilityRuleException(
      `${item.code} is held by ${holder}, not by your organization`,
    );
  }
}

export function requireOperable(item: TraceableItem): void {
  if (isTerminal(item.status)) {
    throw new TraceabilityRuleException(
      `${item.code} is ${item.status} and can no longer be operated on`,
    );
  }
}

/**
 * A lot the caller is entitled to mint identities against.
 *
 * Ownership is the point. Without this check any organization could pass
 * another company's batch id and register units under it: the counterfeit
 * would then verify as genuine and name the wrong manufacturer, the real
 * manufacturer's recall impact would silently include stock it never made,
 * and it could recall goods that were never its own. Minting an identity
 * against a lot is a manufacturing act, so only the lot's manufacturer may
 * do it.
 *
 * A lot with no manufacturer belongs to nobody and is therefore closed to
 * everyone, rather than open to anyone.
 */
export async function requireOwnedBatch(
  manager: EntityManager,
  organization: Organization,
  batchId: number,
): Promise<Batch> {
  const batch = await manager.findOne(Batch, { where: { id: batchId } });
  if (!batch) {
    throw new NotFoundEntityException('Batch', batchId);
  }
  if (batch.manufacturer?.id !== organization.id) {
    throw new TraceabilityRuleException(
      `Batch ${batch.batchCode} was not manufactured by ${organization.name} - ` +
        'only its manufacturer can register items against it',
    );
  }
  return batch;
}

/**
 * A lot a container may be labelled with: one the caller manufactured, or one
 * it is currently holding stock from.
 *
 * Repacking is the reason for the second case - a warehouse that received a
 * pallet of somebody else's lot and splits it into cartons is describing
 * goods it actually has, not claiming to have made them. Requiring stock on
 * hand keeps that legitimate case working without letting an organization
 * attach its containers to a lot it has never touched.
 */
export async function requirePackageableBatch(
  manager: EntityManager,
  organization: Organization,
  batchId: number,
): Promise<Batch> {
  const batch = await manager.findOne(Batch, { where: { id: batchId } });
  if (!batch) {
    throw new NotFoundEntityException('Batch', batchId);
  }
  if (batch.manufacturer?.id === organization.id) {
    return batch;
  }

  const held = await manager.count(TraceableItem, {
    where: { batch: { id: batchId }, holder: { id: organization.id } },
  });
  if (held === 0) {
    throw new TraceabilityRuleException(
      `${organization.name} holds no stock from batch ${batch.batchCode}, ` +
        'so a container cannot be labelled with it',
    );
  }
  return batch;
}

export async function requireOwnedLocation(
  manager: EntityManager,
  organization: Organization,
  locationId: number,
): Promise<Location> {
  const location = await manager.findOne(Location, { where: { id: locationId } });
  if (!location) {
    throw new NotFoundEntityException('Location', locationId);
  }
  if (location.organization.id !== organization.id) {
    throw new TraceabilityRuleException(
      `Location ${locationId} does not belong to ${organization.name}`,
    );
  }
  return location;
}

/**
 * How many units each identity should carry, given the product's level (DR-01).
 *
 * The array's length is how many identities to mint and each entry is that
 * identity's quantity — so the two facts the caller needs come out of one
 * decision rather than being derived twice and disagreeing.
 */
export function unitsPerIdentity(
  product: Product,
  dto: { count: number; unitsPerPackage?: number },
): number[] {
  switch (product.traceabilityLevel) {
    case TraceabilityLevel.BATCH:
      // One identity for the whole lot. A yogurt run is a lot, not ten
      // thousand individually identifiable things.
      return [dto.count];

    case TraceabilityLevel.PACKAGE: {
      const per = dto.unitsPerPackage ?? 1;
      if (per < 1) {
        throw new TraceabilityRuleException(
          'A package has to hold at least one unit',
        );
      }
      // A part-full final pack is normal: 100 units at 24 per case is four
      // full cases and one holding four. Recording it as full invents stock.
      const full = Math.floor(dto.count / per);
      const remainder = dto.count % per;
      return remainder > 0
        ? [...(Array(full).fill(per) as number[]), remainder]
        : (Array(full).fill(per) as number[]);
    }

    case TraceabilityLevel.SERIAL:
    default:
      return Array(dto.count).fill(1) as number[];
  }
}

/** Units registered against a batch so far, counting what each identity holds. */
export async function registeredUnits(
  manager: EntityManager,
  batchId: number,
): Promise<number> {
  const row = await manager
    .createQueryBuilder(TraceableItem, 'i')
    .select('COALESCE(SUM(i.quantity), 0)', 'units')
    .where('i.batch_id = :batchId', { batchId })
    .getRawOne<{ units: string }>();
  return Number(row?.units ?? 0);
}

export { In };

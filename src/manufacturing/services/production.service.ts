import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { BatchStatus } from '../../batch/batch-status.enum';
import { Batch } from '../../batch/entities/batch.entity';
import { BatchService } from '../../batch/services/batch.service';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { SequenceService } from '../../common/sequence.service';
import { TraceableItem, today } from '../../item/entities/traceable-item.entity';
import { registeredUnits } from '../../item/services/item.service';
import { ProductionEligibilityDecision } from '../../licensing/entities/production-eligibility-decision.entity';
import { LicenseEnforcementService } from '../../licensing/services/license-enforcement.service';
import { ProductionEligibilityService } from '../../licensing/services/production-eligibility.service';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import {
  AllocateMaterialsDto,
  AmendQuantityDto,
  CancelProductionDto,
  CompleteProductionDto,
  CreateProductionOrderDto,
  IssueMaterialsDto,
  StartProductionDto,
} from '../dto/production-order.dto';
import { BillOfMaterial, BillOfMaterialLine } from '../entities/bill-of-material.entity';
import { Machine } from '../entities/machine.entity';
import { ProductionEvent } from '../entities/production-event.entity';
import {
  ProductionOrder,
  ProductionOrderMaterial,
} from '../entities/production-order.entity';
import { RawMaterial } from '../entities/raw-material.entity';
import {
  ProductionEventType,
  ProductionOrderStatus,
  canAllocate,
  canCancel,
  canClose,
  canComplete,
  canIssue,
  canStart,
  round2,
  round3,
} from '../manufacturing.enums';

/**
 * The manufacturing workflow from proposal section 7:
 *
 *   Production Order -> Material Allocation -> Production
 *     -> Quality Inspection -> Approval -> Packaging -> Product Registration
 *
 * Planning an order opens its Batch, which is what "product registration"
 * hangs off: the items module registers units against it, and from there the
 * finished goods are ordinary traceable identities. The lot exists from the
 * moment the order does so that every step of the run - start, material
 * issue, completion, inspection - has a lot identity to attach itself to;
 * completion moves it to PENDING_QC rather than bringing it into being.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProductionOrder)
    private readonly orders: Repository<ProductionOrder>,
    @InjectRepository(ProductionOrderMaterial)
    private readonly orderMaterials: Repository<ProductionOrderMaterial>,
    @InjectRepository(ProductionEvent)
    private readonly events: Repository<ProductionEvent>,
    private readonly sequences: SequenceService,
    private readonly licensing: LicenseEnforcementService,
    /**
     * Manufacturing asks whether a run is permitted; it never works the answer
     * out for itself. A second implementation of a regulatory rule is how two
     * answers to the same question come to exist (DR §24 invariant 10).
     */
    private readonly eligibility: ProductionEligibilityService,
    private readonly batches: BatchService,
    private readonly recorder: EventRecorder,
  ) {}

  // --------------------------------------------------------------- workflow

  /**
   * Plans an order. A BOM snapshots its lines into allocations, so the plan
   * carries how much material it expects to need before a gram is issued.
   *
   * This is where DR-07 closes the enforcement hole it was written about: until
   * now, planning a run consulted no licence at all. It does now, and the
   * evaluation taken here — not the preview the screen showed a moment ago — is
   * the authoritative one, because a licence can lapse between the two. The
   * verdict is stored, immutably, and the order points at it; a regulator asking
   * in two years why this run was permitted reads that record rather than
   * watching today's rules re-run against today's licences.
   *
   * Refusal happens only when the verdict is `blocking`. Under the platform's
   * default mode the order is created and a finding is written instead, which is
   * the supervision the proposal describes rather than the gatekeeping it
   * doesn't.
   */
  async create(
    organization: Organization,
    actor: User,
    dto: CreateProductionOrderDto,
  ): Promise<ProductionOrder> {
    const planned = await this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(Product, { where: { id: dto.productId } });
      if (!product) {
        throw new NotFoundEntityException('Product', dto.productId);
      }

      let bom: BillOfMaterial | null = null;
      if (dto.bomId) {
        bom = await manager.findOne(BillOfMaterial, { where: { id: dto.bomId } });
        if (!bom || bom.organization.id !== organization.id) {
          throw new NotFoundEntityException('BOM', dto.bomId);
        }
        if (bom.product.id !== product.id) {
          throw new TraceabilityRuleException(
            `BOM v${bom.version} is for ${bom.product.name}, not ${product.name}`,
          );
        }
        if (!bom.active) {
          throw new TraceabilityRuleException(
            `BOM v${bom.version} is retired - activate it or create a new one`,
          );
        }
      }

      let machine: Machine | null = null;
      if (dto.machineId) {
        machine = await manager.findOne(Machine, { where: { id: dto.machineId } });
        if (!machine || machine.organization.id !== organization.id) {
          throw new NotFoundEntityException('Machine', dto.machineId);
        }
      }

      if (
        dto.scheduledStartOn &&
        dto.scheduledEndOn &&
        dto.scheduledEndOn < dto.scheduledStartOn
      ) {
        throw new TraceabilityRuleException(
          'A production order cannot end before it starts',
        );
      }

      /**
       * Resolved before the licence is consulted, because which site is
       * producing decides which licence governs (D1): a site with its own
       * licence stops relying on the company's, for better and for worse.
       */
      const facilityId = await this.resolveFacility(
        manager,
        organization,
        dto.facilityId,
      );

      /**
       * Judged against the day the run is *for*, not the day it is booked. A
       * licence that is valid this morning and expires before the scheduled
       * start does not cover the run, and this is where a manufacturer finds
       * that out — while there is still time to renew.
       */
      const requestedDate = dto.scheduledStartOn ?? today();

      const verdict = await this.eligibility.evaluate({
        organizationId: organization.id,
        facilityId,
        productId: product.id,
        requestedQuantity: dto.plannedQuantity,
        requestedDate,
      });

      if (verdict.blocking) {
        /**
         * The failing checks travel with the refusal so the wizard can keep
         * showing the list it was already showing, with the remedy links, rather
         * than replacing it with a bare error. 409, not 400: the request was
         * well formed — the world is not in the state it needs to be in.
         */
        const failures = verdict.checks.filter((check) => check.status === 'FAIL');
        throw new TraceabilityRuleException(
          `${organization.name} cannot start this production run. ` +
            failures.map((check) => check.message).join(' '),
          {
            eligible: verdict.eligible,
            blocking: verdict.blocking,
            enforcementMode: verdict.enforcementMode,
            evaluatedAt: verdict.evaluatedAt.toISOString(),
            checks: verdict.checks,
            reliedOn: verdict.reliedOn,
            rulesetVersion: verdict.rulesetVersion,
          },
        );
      }

      /**
       * Inserted in the same transaction as the order, so an order without its
       * justification cannot exist and a justification without its order cannot
       * either (DR §24 invariant 6). Written once and never touched again
       * (invariants 15, 16).
       */
      const decision = await manager.save(
        manager.create(ProductionEligibilityDecision, {
          organizationId: organization.id,
          facilityId,
          productId: product.id,
          requestedQuantity: dto.plannedQuantity,
          requestedDate,
          eligible: verdict.eligible,
          blocking: verdict.blocking,
          enforcementMode: verdict.enforcementMode,
          checks: verdict.checks,
          reliedOn: verdict.reliedOn,
          rulesetVersion: verdict.rulesetVersion,
          evaluatedBy: actor ?? null,
        }),
      );

      const order = await manager.save(
        manager.create(ProductionOrder, {
          orderNumber: await this.nextNumber(manager),
          organization,
          product,
          bom,
          machine,
          facilityId,
          eligibilityDecisionId: decision.id,
          plannedQuantity: dto.plannedQuantity,
          producedQuantity: 0,
          status: ProductionOrderStatus.PLANNED,
          scheduledStartOn: dto.scheduledStartOn ?? null,
          scheduledEndOn: dto.scheduledEndOn ?? null,
          notes: dto.notes ?? null,
        }),
      );

      // The batch is created here — at order creation, not at completion.
      // This is the canonical lifecycle: the lot identity exists from the
      // moment the order is planned, so every subsequent event (production
      // start, material issue, completion, QC) can address it.  The batch
      // starts ACTIVE; completion moves it to PENDING_QC.
      const batch = await manager.save(
        manager.create(Batch, {
          product,
          batchCode: order.orderNumber,
          manufacturer: organization,
          // Carried from the order so a recall can name the plant without
          // walking back through production (DR-02).
          facilityId: order.facilityId,
          manufacturedOn: null,
          expiresOn: null,
        }),
      );
      order.batch = batch;
      await manager.save(ProductionOrder, order);

      if (bom) {
        const lines = await manager.find(BillOfMaterialLine, {
          where: { bom: { id: bom.id } },
        });
        for (const line of lines) {
          await manager.save(
            manager.create(ProductionOrderMaterial, {
              productionOrder: order,
              material: line.material,
              allocatedQuantity: String(
                round3(
                  Number(line.quantityPerUnit) *
                    dto.plannedQuantity *
                    (1 + Number(line.wastagePercent) / 100),
                ),
              ),
              consumedQuantity: '0',
              wastagePercent: line.wastagePercent,
            }),
          );
        }
      }

      await this.recordEvent(manager, order, actor, ProductionEventType.CREATED, {
        notes: dto.notes ?? null,
      });

      return { order, verdict, facilityId };
    });

    /**
     * Written after the transaction commits, and only then.
     *
     * A finding is a statement that something happened. Filing it inside the
     * transaction would leave one behind for a run that rolled back and never
     * existed, and a regulator's evidence trail is the last place to put a
     * record of something that did not occur.
     *
     * Exactly one finding and one round of notices per ineligible run (DR §24
     * invariant 9), and the writing itself stays inside the licensing module —
     * manufacturing asks, it does not file.
     */
    if (!planned.verdict.eligible) {
      await this.licensing.recordIneligibleProduction(
        organization,
        planned.facilityId,
        `plan production order ${planned.order.orderNumber}`,
        planned.verdict.checks
          .filter((check) => check.status === 'FAIL')
          .map((check) => check.message),
        actor,
      );
    }

    return planned.order;
  }

  /** Opens the order for work. This is the moment production starts. */
  async start(
    organization: Organization,
    actor: User,
    orderId: number,
    dto?: StartProductionDto,
  ): Promise<ProductionOrder> {
    // Advisory by default: a finding is recorded and the holder notified, and
    // the run still starts. See LicenseEnforcementService for why the proposal
    // calls for supervision rather than a gate here.
    await this.licensing.checkOwnTrade(organization, 'start production', actor);

    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwn(manager, organization, orderId);
      if (!canStart(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} and cannot be started`,
        );
      }

      order.status = ProductionOrderStatus.IN_PROGRESS;
      order.startedAt = new Date();
      await manager.save(ProductionOrder, order);

      await this.recordEvent(manager, order, actor, ProductionEventType.STARTED, {
        notes: dto?.notes ?? null,
      });

      // The batch was created at order creation. Production starting is the
      // first batch-level lifecycle event — the run is now underway.
      if (order.batch) {
        await this.recorder.record(manager, {
          batch: order.batch,
          type: EventType.PRODUCTION_STARTED,
          actor,
          notes: dto?.notes ?? null,
        });
      }

      return order;
    });
  }

  /**
   * Adds material to the plan. Allocation can grow while the order is running,
   * because reality rarely matches the BOM's forecast exactly.
   */
  async allocate(
    organization: Organization,
    actor: User,
    orderId: number,
    dto: AllocateMaterialsDto,
  ): Promise<ProductionOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwn(manager, organization, orderId);
      if (!canAllocate(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} - materials can only be allocated to a planned or running order`,
        );
      }

      for (const item of dto.materials) {
        const material = await this.requireMaterial(manager, organization, item.materialId);
        if (Number(item.quantity) <= 0) {
          throw new TraceabilityRuleException(
            'Allocated quantity must be greater than zero',
          );
        }

        let row = await manager.findOne(ProductionOrderMaterial, {
          where: {
            productionOrder: { id: order.id },
            material: { id: material.id },
          },
        });
        if (!row) {
          row = manager.create(ProductionOrderMaterial, {
            productionOrder: order,
            material,
            allocatedQuantity: '0',
            consumedQuantity: '0',
            wastagePercent: '0',
          });
          await manager.save(ProductionOrderMaterial, row);
        }

        row.allocatedQuantity = String(
          round3(Number(row.allocatedQuantity) + Number(item.quantity)),
        );
        await manager.save(ProductionOrderMaterial, row);

        await this.recordEvent(manager, order, actor, ProductionEventType.MATERIAL_ALLOCATED, {
          quantity: String(item.quantity),
          notes: `${material.code}: ${item.quantity} ${material.unitOfMeasure} allocated`,
        });
      }

      return order;
    });
  }

  /**
   * Records consumption against the line. Issuing can never outrun what was
   * allocated - the factory floor cannot eat material nobody gave it.
   */
  async issue(
    organization: Organization,
    actor: User,
    orderId: number,
    dto: IssueMaterialsDto,
  ): Promise<ProductionOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwn(manager, organization, orderId);
      if (!canIssue(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} - materials can only be issued to a running order`,
        );
      }

      for (const item of dto.materials) {
        const material = await this.requireMaterial(manager, organization, item.materialId);
        if (Number(item.quantity) <= 0) {
          throw new TraceabilityRuleException(
            'Issued quantity must be greater than zero',
          );
        }

        const row = await manager.findOne(ProductionOrderMaterial, {
          where: {
            productionOrder: { id: order.id },
            material: { id: material.id },
          },
        });
        if (!row) {
          throw new TraceabilityRuleException(
            `${material.code} has not been allocated to ${order.orderNumber} - allocate it before issuing`,
          );
        }

        const allocated = Number(row.allocatedQuantity);
        const consumed = Number(row.consumedQuantity);
        const requested = Number(item.quantity);
        if (consumed + requested > allocated) {
          throw new TraceabilityRuleException(
            `Issuing ${requested} ${material.unitOfMeasure} of ${material.code} would exceed its allocation of ${allocated} (${consumed} already consumed)`,
          );
        }

        row.consumedQuantity = String(round3(consumed + requested));
        await manager.save(ProductionOrderMaterial, row);

        await this.recordEvent(manager, order, actor, ProductionEventType.MATERIAL_ISSUED, {
          quantity: String(requested),
          notes: `${material.code}: ${requested} ${material.unitOfMeasure} issued to production`,
        });

        // A batch-level traceability event so the lot's timeline shows what
        // material went into it, even before identities exist.
        if (order.batch) {
          await this.recorder.record(manager, {
            batch: order.batch,
            type: EventType.MATERIAL_ISSUED,
            actor,
            quantity: requested,
            notes: `${material.code}: ${requested} ${material.unitOfMeasure} issued`,
          });
        }
      }

      return order;
    });
  }

  /**
   * Finishes the run and records what came out. The batch was already opened
   * when the order was created (canonical lifecycle: identity first, verdict
   * later). Completion moves the lot to PENDING_QC so quality control may
   * inspect it.
   *
   * Manual batches created outside a production order default to ACTIVE
   * because there is no production run to inspect — they are catalogue stock
   * that was already cleared. This distinction is deliberate.
   */
  async complete(
    organization: Organization,
    actor: User,
    orderId: number,
    dto?: CompleteProductionDto,
  ): Promise<ProductionOrder> {
    await this.licensing.checkOwnTrade(organization, 'complete production', actor);

    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwn(manager, organization, orderId);
      if (!canComplete(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} and cannot be completed`,
        );
      }

      const producedQuantity = dto?.producedQuantity ?? order.plannedQuantity;
      if (!Number.isInteger(producedQuantity) || producedQuantity <= 0) {
        throw new TraceabilityRuleException(
          'Produced quantity must be a positive whole number',
        );
      }

      // The lot was opened when the order was planned, so it carries no dates
      // yet: nothing had been made. Completion is the moment it was, which is
      // where the manufacture date belongs and where the caller's shelf date
      // is applied. Items copy `expiresOn` from the batch when they are
      // registered, so a lot that finishes without one can never expire.
      const manufacturedOn = today();
      if (dto?.expiresOn && dto.expiresOn < manufacturedOn) {
        throw new TraceabilityRuleException(
          'A batch cannot expire before it was manufactured',
        );
      }

      order.status = ProductionOrderStatus.COMPLETED;
      order.producedQuantity = producedQuantity;
      order.completedAt = new Date();
      await manager.save(ProductionOrder, order);

      await this.recordEvent(manager, order, actor, ProductionEventType.COMPLETED, {
        quantity: String(producedQuantity),
        notes: `Produced ${producedQuantity} — lot awaiting quality control`,
      });

      // Move the lot to PENDING_QC. The batch was created at order creation
      // as ACTIVE; completion means the run is done and the lot is ready for
      // inspection. The audit trail records the transition.
      if (order.batch) {
        order.batch.manufacturedOn = manufacturedOn;
        if (dto?.expiresOn) {
          order.batch.expiresOn = dto.expiresOn;
        }

        // updateStatus saves the batch, so the dates above go with it.
        await this.batches.updateStatus(
          order.batch,
          BatchStatus.PENDING_QC,
          `Production completed: ${producedQuantity} units`,
          manager,
        );

        await this.recorder.record(manager, {
          batch: order.batch,
          type: EventType.PRODUCTION_COMPLETED,
          actor,
          quantity: producedQuantity,
          notes: `Produced ${producedQuantity} units — lot awaiting quality control`,
        });
      }

      return order;
    });
  }

  /**
   * Corrects the recorded output of a completed run. The original quantity
   * stays on the completion event; this appends a PRODUCED_QUANTITY_AMENDED
   * entry that records the change, who made it and why (business rule 14).
   *
   * The new quantity may not go below the number of identities already
   * registered against the batch — you cannot un-make products that already
   * carry QR codes.
   */
  async amendQuantity(
    organization: Organization,
    actor: User,
    orderId: number,
    dto: AmendQuantityDto,
  ): Promise<ProductionOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwn(manager, organization, orderId);
      if (order.status !== ProductionOrderStatus.COMPLETED) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} — only a completed order may have its quantity amended`,
        );
      }

      if (!order.batch) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} has no batch — cannot amend quantity`,
        );
      }

      if (!Number.isInteger(dto.newQuantity) || dto.newQuantity <= 0) {
        throw new TraceabilityRuleException(
          'New quantity must be a positive whole number',
        );
      }

      if (dto.newQuantity === order.producedQuantity) {
        throw new TraceabilityRuleException(
          'New quantity is the same as the current quantity — nothing to amend',
        );
      }

      /**
       * Cannot reduce below what has already been registered. Those units
       * already carry identities and cannot be un-made.
       *
       * Compares units, not rows: the amended figure is a produced quantity, so
       * counting identities would compare it against 1 for a batch-traced
       * product and allow a lot of 10,000 to be amended down to nothing (DR-01).
       */
      const registered = await registeredUnits(manager, order.batch.id);
      if (dto.newQuantity < registered) {
        throw new TraceabilityRuleException(
          `Cannot reduce to ${dto.newQuantity}: ${registered} units ` +
            `are already registered against batch ${order.batch.batchCode}`,
        );
      }

      const previousQuantity = order.producedQuantity;
      order.producedQuantity = dto.newQuantity;
      await manager.save(ProductionOrder, order);

      // The production-level event records the before-and-after.
      await manager.save(
        manager.create(ProductionEvent, {
          productionOrder: order,
          type: ProductionEventType.QUANTITY_AMENDED,
          actor,
          quantity: String(dto.newQuantity),
          previousQuantity: String(previousQuantity),
          notes: dto.reason,
        }),
      );

      // The batch-level traceability event so the lot's timeline shows the
      // amendment, preserving the history the auditor needs.
      await this.recorder.record(manager, {
        batch: order.batch,
        type: EventType.PRODUCED_QUANTITY_AMENDED,
        actor,
        quantity: dto.newQuantity,
        notes: `${previousQuantity} → ${dto.newQuantity}: ${dto.reason}`,
      });

      return order;
    });
  }

  /** Abandons the run. No batch is opened for a cancelled order. */
  async cancel(
    organization: Organization,
    actor: User,
    orderId: number,
    dto: CancelProductionDto,
  ): Promise<ProductionOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwn(manager, organization, orderId);
      if (!canCancel(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} and cannot be cancelled`,
        );
      }

      order.status = ProductionOrderStatus.CANCELLED;
      await manager.save(ProductionOrder, order);

      await this.recordEvent(manager, order, actor, ProductionEventType.CANCELLED, {
        notes: dto.reason,
      });

      return order;
    });
  }

  /** Closes out completed work. Records are never deleted, just finished. */
  async close(
    organization: Organization,
    actor: User,
    orderId: number,
  ): Promise<ProductionOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.requireOwn(manager, organization, orderId);
      if (!canClose(order.status)) {
        throw new TraceabilityRuleException(
          `Order ${order.orderNumber} is ${order.status} - only completed work can be closed`,
        );
      }

      order.status = ProductionOrderStatus.CLOSED;
      await manager.save(ProductionOrder, order);

      await this.recordEvent(manager, order, actor, ProductionEventType.CLOSED);

      return order;
    });
  }

  // ----------------------------------------------------------------- reads

  async list(
    organization: Organization,
    status: ProductionOrderStatus | undefined,
    page: number,
    size: number,
  ): Promise<{
    content: ProductionOrder[];
    total: number;
    page: number;
    size: number;
  }> {
    const where: Record<string, unknown> = { organization: { id: organization.id } };
    if (status) {
      where.status = status;
    }
    const [content, total] = await this.orders.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async get(organization: Organization, orderId: number): Promise<ProductionOrder> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order || order.organization.id !== organization.id) {
      throw new NotFoundEntityException('Production order', orderId);
    }
    return order;
  }

  async materialsOf(orderId: number): Promise<ProductionOrderMaterial[]> {
    return this.orderMaterials.find({
      where: { productionOrder: { id: orderId } },
      order: { id: 'ASC' },
    });
  }

  async eventsOf(orderId: number): Promise<ProductionEvent[]> {
    return this.events.find({
      where: { productionOrder: { id: orderId } },
      order: { recordedAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * What the run cost, priced from what it actually consumed at the materials'
   * current unit cost. This is indicative production costing (proposal section
   * 3), not ledger-grade - it values at issue, not at weighted average.
   */
  async costOf(orderId: number): Promise<{
    materialCost: number;
    costPerUnit: number | null;
  }> {
    const rows = await this.orderMaterials.find({
      where: { productionOrder: { id: orderId } },
      relations: { material: true },
    });

    const materialCost = rows.reduce(
      (sum, row) => sum + Number(row.consumedQuantity) * Number(row.material.unitCost),
      0,
    );

    const order = await this.orders.findOne({ where: { id: orderId } });
    const costPerUnit =
      order && order.producedQuantity > 0 ? materialCost / order.producedQuantity : null;

    return {
      materialCost: round2(materialCost),
      costPerUnit: costPerUnit === null ? null : round2(costPerUnit),
    };
  }

  // --------------------------------------------------------------- shared

  private async requireOwn(
    manager: EntityManager,
    organization: Organization,
    orderId: number,
  ): Promise<ProductionOrder> {
    const order = await manager.findOne(ProductionOrder, { where: { id: orderId } });
    if (!order || order.organization.id !== organization.id) {
      throw new NotFoundEntityException('Production order', orderId);
    }
    return order;
  }

  private async requireMaterial(
    manager: EntityManager,
    organization: Organization,
    materialId: number,
  ): Promise<RawMaterial> {
    const material = await manager.findOne(RawMaterial, { where: { id: materialId } });
    if (!material || material.organization.id !== organization.id) {
      throw new NotFoundEntityException('Raw material', materialId);
    }
    return material;
  }

  private async recordEvent(
    manager: EntityManager,
    order: ProductionOrder,
    actor: User,
    type: ProductionEventType,
    detail?: { quantity?: string | null; notes?: string | null },
  ): Promise<void> {
    await manager.save(
      manager.create(ProductionEvent, {
        productionOrder: order,
        type,
        actor,
        quantity: detail?.quantity ?? null,
        notes: detail?.notes ?? null,
      }),
    );
  }

  /**
   * The site a run happens at (DR-02).
   *
   * A named facility must belong to the caller — pointing a production order at
   * another business's plant would put their name on your batch. Where none is
   * named, the organization's only site is used, which keeps single-site
   * manufacturers from having to answer a question that has one possible answer.
   * A business with several sites must say which, because guessing would put a
   * recall at the wrong plant.
   */
  private async resolveFacility(
    manager: EntityManager,
    organization: Organization,
    facilityId?: number,
  ): Promise<number | null> {
    if (facilityId !== undefined) {
      const facility = await manager.findOne(Facility, {
        where: { id: facilityId },
      });
      if (!facility || facility.organizationId !== organization.id) {
        throw new NotFoundEntityException('Facility', facilityId);
      }
      if (!facility.active) {
        throw new TraceabilityRuleException(
          `${facility.name} is no longer in operation`,
        );
      }
      return facility.id;
    }

    const own = await manager.find(Facility, {
      where: { organizationId: organization.id },
      order: { id: 'ASC' },
    });
    const open = own.filter((facility) => facility.active);

    if (open.length === 1) {
      return open[0].id;
    }
    if (open.length > 1) {
      throw new TraceabilityRuleException(
        `${organization.name} operates ${open.length} sites — say which one is producing this`,
      );
    }

    /**
     * Sites exist but every one of them has closed.
     *
     * This has to fail rather than fall through to the no-site case below.
     * Falling through would produce an unsited batch for a business that does
     * have sites — the DR-02 guarantee would not break loudly, it would just
     * quietly stop being true for everything made from here on, and the gap
     * would only surface during a recall, which is the worst moment to find it.
     */
    if (own.length > 0) {
      throw new TraceabilityRuleException(
        `${organization.name} has no site in operation — reopen one before producing, ` +
          'because every batch has to record where it was made',
      );
    }

    // A business that has never had a site is not forced to invent a plant.
    return null;
  }

  private async nextNumber(manager: EntityManager): Promise<string> {
    const n = await this.sequences.next(manager, 'MO');
    return `MO-${String(n).padStart(6, '0')}`;
  }
}

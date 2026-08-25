import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { ItemStatus, NON_PHYSICAL_STATUSES } from '../../item/item.enums';
import { ItemService } from '../../item/services/item.service';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { StockAdjustmentDto } from '../dto/inventory.dto';

export interface StatusCount {
  status: ItemStatus;
  units: number;
  identities: number;
}

export interface InventoryPosition {
  productId: number | null;
  productName: string | null;
  productSku: string | null;
  availableUnits: number;
  blockedUnits: number;
  inTransitUnits: number;
  identities: number;
  byStatus: StatusCount[];
}

/**
 * Current stock, computed from the identities an organization holds. There is
 * no quantity column to keep in step with the event log, so inventory cannot
 * silently disagree with history (business rule 4).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(Location)
    private readonly locations: Repository<Location>,
    private readonly itemService: ItemService,
    private readonly recorder: EventRecorder,
  ) {}

  async positions(
    organization: Organization,
    locationId?: number,
  ): Promise<InventoryPosition[]> {
    if (locationId !== undefined) {
      const location = await this.locations.findOne({ where: { id: locationId } });
      if (!location) {
        throw new NotFoundEntityException('Location', locationId);
      }
      if (location.organization.id !== organization.id) {
        throw new TraceabilityRuleException(
          `Location ${locationId} does not belong to ${organization.name}`,
        );
      }
    }

    /**
     * Counts leaf identities - those holding nothing else - rather than
     * top-level ones.
     *
     * Counting from the top means trusting a container's rolled-up quantity,
     * which goes stale the moment anything nested changes, and means a mixed
     * pallet carrying no product of its own disappears from stock entirely.
     * Counting leaves has neither problem: every physical thing is counted
     * exactly once, at the level where it actually knows what it is. A bulk
     * container with no child identities is itself a leaf, so sacks and cases
     * that were never opened still count for their full quantity.
     */
    const query = this.items
      .createQueryBuilder('i')
      .leftJoin('products', 'p', 'p.id = i.product_id')
      .select('i.product_id', 'productId')
      .addSelect('p.name', 'productName')
      .addSelect('p.sku', 'productSku')
      .addSelect('i.status', 'status')
      .addSelect('SUM(i.quantity)', 'units')
      .addSelect('COUNT(i.id)', 'identities')
      .where('i.holder_id = :organizationId', { organizationId: organization.id })
      /**
       * Codes that name no physical thing (DR-08). A null holder already keeps
       * a freshly minted pool out of this query, so this is the second lock on
       * the same door - and the one that still holds if a later change ever
       * gives a pre-production identity a holder. Reporting ten thousand
       * printed labels as ten thousand bottles is the single worst thing this
       * table could say.
       */
      .andWhere('i.status NOT IN (:...nonPhysical)', {
        nonPhysical: NON_PHYSICAL_STATUSES,
      })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM traceable_items c WHERE c.parent_id = i.id)',
      )
      .groupBy('i.product_id')
      .addGroupBy('p.name')
      .addGroupBy('p.sku')
      .addGroupBy('i.status')
      .orderBy('p.name', 'ASC');

    if (locationId !== undefined) {
      query.andWhere('i.location_id = :locationId', { locationId });
    }

    const rows = await query.getRawMany<{
      productId: number | null;
      productName: string | null;
      productSku: string | null;
      status: ItemStatus;
      units: string;
      identities: string;
    }>();

    // Rows arrive split by status; fold them back into one line per product.
    const byProduct = new Map<string, InventoryPosition>();

    for (const row of rows) {
      const key = String(row.productId ?? 'unassigned');
      let position = byProduct.get(key);
      if (!position) {
        position = {
          productId: row.productId,
          productName: row.productName,
          productSku: row.productSku,
          availableUnits: 0,
          blockedUnits: 0,
          inTransitUnits: 0,
          identities: 0,
          byStatus: [],
        };
        byProduct.set(key, position);
      }

      const units = parseInt(row.units ?? '0', 10);
      const identities = parseInt(row.identities ?? '0', 10);

      position.byStatus.push({ status: row.status, units, identities });
      position.identities += identities;

      switch (row.status) {
        case ItemStatus.ACTIVE:
          position.availableUnits += units;
          break;
        case ItemStatus.IN_TRANSIT:
          position.inTransitUnits += units;
          break;
        // Sold and destroyed goods are history, not stock on hand.
        case ItemStatus.SOLD:
        case ItemStatus.DESTROYED:
          break;
        // Everything else - returned, quarantined, recalled, expired,
        // damaged - is physically present but not sellable.
        default:
          position.blockedUnits += units;
      }
    }

    return [...byProduct.values()];
  }

  /**
   * Records the result of a physical stock count (cycle count).  For each
   * item where the physical count differs from the system, a CORRECTION
   * event is appended to the item's timeline with the delta and the reason.
   *
   * Items may optionally be marked as DAMAGED during the count — this is
   * the most common reason for a negative discrepancy.
   */
  async adjust(
    organization: Organization,
    actor: User,
    dto: StockAdjustmentDto,
  ): Promise<{ adjusted: number; corrections: number }> {
    const location = await this.locations.findOne({ where: { id: dto.locationId } });
    if (!location) {
      throw new NotFoundEntityException('Location', dto.locationId);
    }
    if (location.organization.id !== organization.id) {
      throw new TraceabilityRuleException(
        `Location ${dto.locationId} does not belong to ${organization.name}`,
      );
    }

    let adjusted = 0;
    let corrections = 0;

    for (const adj of dto.adjustments) {
      const item = await this.itemService.require(adj.itemQrCode);

      if (item.holder?.id !== organization.id) {
        throw new TraceabilityRuleException(
          `${item.code} is not held by ${organization.name}`,
        );
      }

      // Record a correction event when the counts differ.
      if (adj.systemCount !== adj.physicalCount) {
        const delta = adj.physicalCount - adj.systemCount;
        await this.dataSource.transaction(async (manager) => {
          // Optionally override the item's status (e.g. mark as DAMAGED).
          if (
            adj.statusOverride &&
            adj.statusOverride !== item.status &&
            Object.values(ItemStatus).includes(adj.statusOverride as ItemStatus)
          ) {
            item.status = adj.statusOverride as ItemStatus;
            await manager.save(TraceableItem, item);
          }

          await this.recorder.record(manager, {
            item,
            type: EventType.CORRECTION,
            actor,
            sourceOrganization: organization,
            sourceLocation: location,
            quantity: delta,
            notes: `Cycle count: system ${adj.systemCount} → physical ${adj.physicalCount}. ${adj.reason}`,
          });
        });
        corrections++;
      }

      adjusted++;
    }

    return { adjusted, corrections };
  }
}

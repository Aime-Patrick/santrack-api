import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { TraceableItem, today } from '../item/entities/traceable-item.entity';
import { ItemStatus, NON_PHYSICAL_STATUSES } from '../item/item.enums';
import { Organization } from '../organization/entities/organization.entity';
import { TraceabilityEvent } from '../traceability/entities/traceability-event.entity';
import { Transfer, TransferStatus } from '../transfer/entities/transfer.entity';
import { InventoryService } from '../inventory/services/inventory.service';

export interface DashboardSummary {
  identitiesHeld: number;
  availableUnits: number;
  blockedUnits: number;
  inTransitUnits: number;
  distinctProducts: number;
  scansToday: number;
  pendingIncomingTransfers: number;
  blockedIdentities: number;
  expiringWithin30Days: number;
}

/**
 * Operational summary for the caller's organization, derived entirely from the
 * traceability engine. There is no separate stock ledger to fall out of step
 * with it, so what the dashboard shows and what the timeline proves are the
 * same numbers.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(TraceabilityEvent)
    private readonly events: Repository<TraceabilityEvent>,
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    private readonly inventory: InventoryService,
  ) {}

  async summary(organization: Organization): Promise<DashboardSummary> {
    const positions = await this.inventory.positions(organization);

    const availableUnits = positions.reduce((n, p) => n + p.availableUnits, 0);
    const blockedUnits = positions.reduce((n, p) => n + p.blockedUnits, 0);
    const inTransitUnits = positions.reduce((n, p) => n + p.inTransitUnits, 0);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [identitiesHeld, scansToday, pendingIncomingTransfers, blockedIdentities] =
      await Promise.all([
        // Held identities means products held. A minted code is neither
        // held nor a product, so Not(In(...)) keeps a print run out of the
        // number on the front page (DR-08).
        this.items.count({
          where: {
            holder: { id: organization.id },
            status: Not(In(NON_PHYSICAL_STATUSES as ItemStatus[])),
          },
        }),
        this.events
          .createQueryBuilder('e')
          .innerJoin('traceable_items', 'i', 'i.id = e.item_id')
          .where('i.holder_id = :org', { org: organization.id })
          .andWhere('e.recorded_at >= :since', { since: startOfToday })
          .getCount(),
        this.transfers.count({
          where: {
            destinationOrganization: { id: organization.id },
            status: TransferStatus.DISPATCHED,
          },
        }),
        this.items
          .createQueryBuilder('i')
          .where('i.holder_id = :org', { org: organization.id })
          .andWhere('i.status IN (:...blocked)', {
            blocked: [
              ItemStatus.QUARANTINED,
              ItemStatus.RECALLED,
              ItemStatus.EXPIRED,
              ItemStatus.DAMAGED,
              ItemStatus.RETURNED,
            ],
          })
          .getCount(),
      ]);

    // Thirty days is the window in which a warehouse can still act - move it,
    // discount it, or send it back - rather than simply discover it expired.
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);
    const horizonDate = horizon.toISOString().slice(0, 10);

    const expiringWithin30Days = await this.items
      .createQueryBuilder('i')
      .where('i.holder_id = :org', { org: organization.id })
      .andWhere('i.expires_on IS NOT NULL')
      .andWhere('i.expires_on >= :from', { from: today() })
      .andWhere('i.expires_on <= :to', { to: horizonDate })
      .andWhere('i.status = :active', { active: ItemStatus.ACTIVE })
      .getCount();

    return {
      identitiesHeld,
      availableUnits,
      blockedUnits,
      inTransitUnits,
      distinctProducts: positions.length,
      scansToday,
      pendingIncomingTransfers,
      blockedIdentities,
      expiringWithin30Days,
    };
  }
}

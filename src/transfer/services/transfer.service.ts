import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { User } from '../../auth/entities/user.entity';
import { permitsTrade } from '../../batch/batch-status.enum';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { ItemStatus } from '../../item/item.enums';
import {
  ItemService,
  requireHeldBy,
  requireOperable,
  requireOwnedLocation,
} from '../../item/services/item.service';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { DispatchDto, ReceiveDto, RelocateDto } from '../dto/transfer.dto';
import { Transfer, TransferLine, TransferStatus } from '../entities/transfer.entity';

/**
 * Moves custody between parties. Dispatch and receipt are separate steps, so
 * goods in transit are visible as such and a discrepancy at the receiving end
 * surfaces instead of disappearing (business rule 6).
 */
@Injectable()
export class TransferService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    @InjectRepository(TransferLine)
    private readonly lines: Repository<TransferLine>,
    private readonly itemService: ItemService,
    private readonly recorder: EventRecorder,
  ) {}

  /**
   * Sends scanned identities towards another party. A sealed container may be
   * dispatched as a whole; everything nested inside travels with it and is
   * marked in transit too, so no unit is left behind at the source.
   */
  async dispatch(
    source: Organization,
    actor: User,
    dto: DispatchDto,
  ): Promise<Transfer> {
    await this.recorder.rejectReplay(dto.meta);

    return this.dataSource.transaction(async (manager) => {
      const destination = await manager.findOne(Organization, {
        where: { id: dto.destinationOrganizationId },
      });
      if (!destination) {
        throw new NotFoundEntityException('Organization', dto.destinationOrganizationId);
      }
      if (destination.id === source.id) {
        throw new TraceabilityRuleException(
          'Use POST /api/transfers/relocate to move stock within one organization',
        );
      }

      const sourceLocation = dto.sourceLocationId
        ? await requireOwnedLocation(manager, source, dto.sourceLocationId)
        : null;

      // The destination's own location, validated against the destination
      // organization rather than the caller's.
      const destinationLocation = dto.destinationLocationId
        ? await requireLocationOf(manager, destination, dto.destinationLocationId)
        : null;

      const transfer = await manager.save(
        manager.create(Transfer, {
          reference: nextReference('TRF'),
          sourceOrganization: source,
          sourceLocation,
          destinationOrganization: destination,
          destinationLocation,
          status: TransferStatus.DISPATCHED,
          dispatchedBy: actor,
          notes: dto.notes ?? null,
        }),
      );

      let first = true;
      for (const qrCode of dto.itemQrCodes) {
        const item = await this.itemService.require(qrCode, manager);
        requireHeldBy(item, source);
        requireOperable(item);

        if (item.status === ItemStatus.IN_TRANSIT) {
          throw new TraceabilityRuleException(`${item.code} is already in transit`);
        }
        if (item.status === ItemStatus.RESERVED) {
          throw new TraceabilityRuleException(
            `${item.code} is reserved for a sales order — fulfil the order to dispatch it, or release the reservation first`,
          );
        }
        if (item.parent) {
          throw new TraceabilityRuleException(
            `${item.code} is inside ${item.parent.code} - dispatch the container, or remove the item first`,
          );
        }

        // Same gate as sale: a lot still waiting on QC (or rejected / held)
        // must not leave the manufacturer. Sale already enforced this;
        // dispatch used not to, which is how unfinished lots reached shops.
        const members = await this.itemService.withDescendants(manager, item);
        for (const member of members) {
          const batch =
            member.batch ??
            (
              await manager.findOne(TraceableItem, {
                where: { id: member.id },
                relations: { batch: true },
              })
            )?.batch;
          if (batch && !permitsTrade(batch.status)) {
            throw new TraceabilityRuleException(
              `Lot ${batch.batchCode} is ${batch.status} and cannot be shipped until it is approved`,
            );
          }
        }

        await manager.save(manager.create(TransferLine, { transfer, item }));

        // Custody stays with the source until receipt is confirmed; only the
        // status changes, so stock cannot be sold while it travels.
        for (const member of members) {
          member.status = ItemStatus.IN_TRANSIT;
          await manager.save(TraceableItem, member);
        }

        await this.recorder.record(manager, {
          item,
          type: EventType.DISPATCHED,
          actor,
          meta: first ? dto.meta : null,
          sourceOrganization: source,
          sourceLocation,
          destinationOrganization: destination,
          destinationLocation,
          quantity: item.quantity,
          notes: dto.notes ?? null,
        });

        first = false;
      }

      return transfer;
    });
  }

  /**
   * The destination party confirms it physically has the goods. This is the
   * moment custody actually changes hands.
   */
  async receive(
    destination: Organization,
    actor: User,
    transferId: number,
    dto?: ReceiveDto,
  ): Promise<{ transfer: Transfer; lines: TransferLine[]; missing: string[] }> {
    await this.recorder.rejectReplay(dto?.meta);

    return this.dataSource.transaction(async (manager) => {
      const transfer = await manager.findOne(Transfer, { where: { id: transferId } });
      if (!transfer) {
        throw new NotFoundEntityException('Transfer', transferId);
      }
      if (transfer.destinationOrganization.id !== destination.id) {
        throw new TraceabilityRuleException(
          `Transfer ${transfer.reference} is not addressed to your organization`,
        );
      }
      if (
        transfer.status !== TransferStatus.DISPATCHED &&
        transfer.status !== TransferStatus.PARTIALLY_RECEIVED
      ) {
        throw new TraceabilityRuleException(
          `Transfer ${transfer.reference} is ${transfer.status} and cannot receive more items`,
        );
      }

      const destinationLocation = dto?.destinationLocationId
        ? await requireOwnedLocation(manager, destination, dto.destinationLocationId)
        : transfer.destinationLocation;
      transfer.destinationLocation = destinationLocation;

      const scanned = new Set(dto?.scannedQrCodes ?? []);
      const lines = await manager.find(TransferLine, {
        where: { transfer: { id: transfer.id } },
      });

      const missing: string[] = [];
      let first = true;

      for (const line of lines) {
        const item = line.item;

        // A blind receipt (nothing scanned back) accepts the whole dispatch;
        // a partial scan flags what did not arrive.
        const confirmed =
          scanned.size === 0 || scanned.has(item.qrCode) || scanned.has(item.code);

        if (!confirmed) {
          missing.push(item.code);
          continue;
        }

        for (const member of await this.itemService.withDescendants(manager, item)) {
          member.holder = destination;
          member.location = destinationLocation;
          if (member.status === ItemStatus.IN_TRANSIT) {
            member.status = ItemStatus.ACTIVE;
          }
          await manager.save(TraceableItem, member);
        }

        await this.recorder.record(manager, {
          item,
          type: EventType.RECEIVED,
          actor,
          meta: first ? dto?.meta : null,
          sourceOrganization: transfer.sourceOrganization,
          sourceLocation: transfer.sourceLocation,
          destinationOrganization: destination,
          destinationLocation,
          quantity: item.quantity,
          notes: dto?.notes ?? null,
        });

        first = false;
      }

      if (missing.length > 0) {
        // Some items did not arrive — keep the transfer open so they can
        // be received later, and record which codes are outstanding.
        transfer.status = TransferStatus.PARTIALLY_RECEIVED;
        transfer.missingItems = missing.join(',');
      } else {
        // All items accounted for — close the transfer.
        transfer.status = TransferStatus.RECEIVED;
        transfer.missingItems = null;
      }
      transfer.receivedBy = actor;
      transfer.receivedAt = new Date();
      await manager.save(Transfer, transfer);

      return { transfer, lines, missing };
    });
  }

  /**
   * Moves stock between two locations of the same organization. Custody does
   * not change, so this is not a transfer and needs no second-party
   * confirmation - but it is still a movement, and the timeline has to show
   * where the goods went.
   */
  async relocate(
    organization: Organization,
    actor: User,
    dto: RelocateDto,
  ): Promise<TraceableItem[]> {
    await this.recorder.rejectReplay(dto.meta);

    return this.dataSource.transaction(async (manager) => {
      const destination = await requireOwnedLocation(
        manager,
        organization,
        dto.destinationLocationId,
      );

      const moved: TraceableItem[] = [];
      let first = true;

      for (const qrCode of dto.itemQrCodes) {
        const item = await this.itemService.require(qrCode, manager);
        requireHeldBy(item, organization);
        requireOperable(item);

        if (item.status === ItemStatus.IN_TRANSIT) {
          throw new TraceabilityRuleException(
            `${item.code} is in transit to another party and cannot be relocated`,
          );
        }
        if (item.status === ItemStatus.RESERVED) {
          throw new TraceabilityRuleException(
            `${item.code} is reserved for a sales order and cannot be relocated`,
          );
        }
        if (item.parent) {
          throw new TraceabilityRuleException(
            `${item.code} is inside ${item.parent.code} - relocate the container instead`,
          );
        }

        const from = item.location;

        // Contents follow the container: a pallet does not move without the
        // boxes on it.
        for (const member of await this.itemService.withDescendants(manager, item)) {
          member.location = destination;
          await manager.save(TraceableItem, member);
        }

        await this.recorder.record(manager, {
          item,
          type: EventType.RELOCATED,
          actor,
          meta: first ? dto.meta : null,
          sourceOrganization: organization,
          sourceLocation: from,
          destinationOrganization: organization,
          destinationLocation: destination,
          quantity: item.quantity,
          notes: dto.notes ?? null,
        });

        moved.push(item);
        first = false;
      }

      return moved;
    });
  }

  /** Pulls back a dispatch the destination has not confirmed yet. */
  async cancel(
    source: Organization,
    actor: User,
    transferId: number,
  ): Promise<Transfer> {
    return this.dataSource.transaction(async (manager) => {
      const transfer = await manager.findOne(Transfer, { where: { id: transferId } });
      if (!transfer) {
        throw new NotFoundEntityException('Transfer', transferId);
      }
      if (transfer.sourceOrganization.id !== source.id) {
        throw new TraceabilityRuleException(
          'Only the dispatching organization can cancel a transfer',
        );
      }
      if (transfer.status !== TransferStatus.DISPATCHED) {
        throw new TraceabilityRuleException(
          `Transfer ${transfer.reference} is already ${transfer.status}`,
        );
      }

      const lines = await manager.find(TransferLine, {
        where: { transfer: { id: transfer.id } },
      });

      for (const line of lines) {
        for (const member of await this.itemService.withDescendants(manager, line.item)) {
          if (member.status === ItemStatus.IN_TRANSIT) {
            member.status = ItemStatus.ACTIVE;
            await manager.save(TraceableItem, member);
          }
        }

        // A cancellation compensates the dispatch rather than erasing it.
        await this.recorder.record(manager, {
          item: line.item,
          type: EventType.CORRECTION,
          actor,
          sourceOrganization: transfer.sourceOrganization,
          sourceLocation: transfer.sourceLocation,
          notes: `Dispatch ${transfer.reference} cancelled before receipt`,
        });
      }

      transfer.status = TransferStatus.CANCELLED;
      return manager.save(Transfer, transfer);
    });
  }

  async findLines(transferId: number): Promise<TransferLine[]> {
    return this.lines.find({ where: { transfer: { id: transferId } } });
  }

  async listOutgoing(organization: Organization, page: number, size: number) {
    const [content, total] = await this.transfers.findAndCount({
      where: { sourceOrganization: { id: organization.id } },
      order: { dispatchedAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async listIncoming(
    organization: Organization,
    pendingOnly: boolean,
    page: number,
    size: number,
  ) {
    const where: Record<string, unknown> = {
      destinationOrganization: { id: organization.id },
    };
    if (pendingOnly) {
      where.status = TransferStatus.DISPATCHED;
    }
    const [content, total] = await this.transfers.findAndCount({
      where,
      order: { dispatchedAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  /**
   * One transfer, visible only to the two parties on it. A dispatch note names
   * both businesses and what moved between them - not public information.
   */
  async get(organization: Organization, transferId: number): Promise<Transfer> {
    const transfer = await this.transfers.findOne({ where: { id: transferId } });
    if (!transfer) {
      throw new NotFoundEntityException('Transfer', transferId);
    }
    const party =
      transfer.sourceOrganization.id === organization.id ||
      transfer.destinationOrganization.id === organization.id ||
      organization.type === 'REGULATOR';
    if (!party) {
      throw new NotFoundEntityException('Transfer', transferId);
    }
    return transfer;
  }
}

async function requireLocationOf(
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

function nextReference(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export { nextReference };

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { TraceabilityRuleException } from '../../common/errors';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { TraceableItem } from '../entities/traceable-item.entity';
import { ItemKind, ItemStatus, SealState } from '../item.enums';
import { StockInDto } from '../dto/stock-in.dto';
import { ItemService } from './item.service';

/**
 * Stock In for RETAILER / SHOP.
 *
 * The operator scans one QR code and presses Confirm Stock In.
 * This service does everything else in one atomic transaction:
 *
 *   1. Validate the organisation type (RETAILER or SHOP only)
 *   2. Resolve the scanned QR to a container identity
 *   3. Reject replayed requests (idempotency via clientEventId)
 *   4. Detect already-received containers and return the existing receipt
 *   5. Transfer custody of the entire hierarchy to the receiving organisation
 *   6. If the container is SEALED, transition it to OPEN automatically
 *   7. Activate all descendant units (IN_TRANSIT → ACTIVE, etc.)
 *   8. Append PACKAGE_OPENED (if applicable) + RECEIVED traceability events
 *   9. Return a receipt summary
 *
 * HANDLE_PACKAGING authorises the packaging state transitions performed here.
 * It does NOT surface as a separate user-facing step for RETAILER/SHOP — the
 * single "Confirm Stock In" covers everything internally.
 */
@Injectable()
export class StockInService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    private readonly itemService: ItemService,
    private readonly recorder: EventRecorder,
  ) {}

  // ── Preview (read-only) ──────────────────────────────────────────────────

  /**
   * Returns a read-only summary of the container the operator just scanned.
   * No state is changed; no events are written.
   */
  async preview(
    organization: Organization,
    containerQr: string,
  ): Promise<StockInPreview> {
    this.requireTradingOrg(organization);

    const container = await this.itemService.require(containerQr);

    if (container.kind !== ItemKind.PACKAGE) {
      throw new TraceabilityRuleException(
        `${container.code} is an individual unit, not a container. ` +
          'Scan the pallet or carton QR code.',
      );
    }

    const { present } = await this.itemService.contents(container);
    const units = present.filter((i) => i.kind === ItemKind.UNIT);
    const containers = present.filter((i) => i.kind === ItemKind.PACKAGE);

    return {
      container: {
        id: container.id,
        qrCode: container.qrCode,
        code: container.code,
        packageType: container.packageType,
        sealState: container.sealState,
        quantity: container.quantity,
        holderId: container.holder?.id ?? null,
        holderName: container.holder?.name ?? null,
        locationId: container.location?.id ?? null,
        locationName: container.location?.name ?? null,
        productId: container.product?.id ?? null,
        productName: container.product?.name ?? null,
      },
      directChildCount: present.length,
      unitCount: units.length,
      nestedContainerCount: containers.length,
      alreadyHeld: container.holder?.id === organization.id,
    };
  }

  // ── Confirm ──────────────────────────────────────────────────────────────

  /**
   * Executes the complete Stock In atomically.
   *
   * Idempotent: if the container and all its descendants are already ACTIVE
   * under this organisation the call returns the current state without writing
   * duplicate records.
   */
  async confirm(
    organization: Organization,
    actor: User,
    dto: StockInDto,
  ): Promise<StockInReceipt> {
    this.requireTradingOrg(organization);

    // Idempotency check via clientEventId before opening a transaction.
    await this.recorder.rejectReplay(dto.meta);

    return this.dataSource.transaction(async (manager) => {
      // ── 1. Resolve container ─────────────────────────────────────────────
      const container = await this.itemService.require(dto.containerQrCode, manager);

      if (container.kind !== ItemKind.PACKAGE) {
        throw new TraceabilityRuleException(
          `${container.code} is an individual unit, not a container. ` +
            'Scan the pallet or carton QR code.',
        );
      }

      // ── 2. Domain-level idempotency guard ────────────────────────────────
      // If this organisation already holds the container and every descendant
      // is ACTIVE here, this Stock In was already processed. Return the
      // current state without writing a second copy of history.
      const all = await this.itemService.withDescendants(manager, container);
      if (container.holder?.id === organization.id) {
        const alreadySettled = all.every(
          (i) => i.holder?.id === organization.id && i.status === ItemStatus.ACTIVE,
        );
        if (alreadySettled) {
          return this.buildReceipt(organization, container, all, 'idempotent');
        }
      }

      // ── 3. Resolve optional destination location ─────────────────────────
      let destinationLocation: Location | null = null;
      if (dto.locationId) {
        const loc = await manager.findOne(Location, {
          where: { id: dto.locationId },
          relations: { organization: true },
        });
        if (!loc || loc.organization?.id !== organization.id) {
          throw new TraceabilityRuleException(
            `Location ${dto.locationId} is not within your organisation`,
          );
        }
        destinationLocation = loc;
      }

      // ── 4. Record previous state for the audit trail ─────────────────────
      const previousHolder = container.holder ?? null;
      const previousLocation = container.location ?? null;
      const wasSealed = container.sealState === SealState.SEALED;

      // ── 5. Transfer custody of the entire hierarchy ──────────────────────
      for (const item of all) {
        item.holder = organization;
        if (destinationLocation) {
          item.location = destinationLocation;
        }
        if (
          item.status === ItemStatus.IN_TRANSIT ||
          item.status === ItemStatus.ACTIVE ||
          item.status === ItemStatus.RESERVED
        ) {
          item.status = ItemStatus.ACTIVE;
        }
        await manager.save(TraceableItem, item);
      }

      // ── 6. Open sealed container automatically ───────────────────────────
      // A sealed container arriving at a retailer/shop means its contents were
      // not inspected in transit — the retailer receives the sealed unit and
      // the system transitions it to OPEN so its contents are visible and
      // countable.
      if (wasSealed) {
        container.sealState = SealState.OPEN;
        await manager.save(TraceableItem, container);

        await this.recorder.record(manager, {
          item: container,
          type: EventType.PACKAGE_OPENED,
          actor,
          sourceOrganization: previousHolder,
          sourceLocation: previousLocation,
          destinationOrganization: organization,
          destinationLocation,
          notes: 'Automatically opened during Stock In',
        });
      }

      // ── 7. Write RECEIVED event for the container ────────────────────────
      await this.recorder.record(manager, {
        item: container,
        type: EventType.RECEIVED,
        actor,
        meta: dto.meta,
        sourceOrganization: previousHolder,
        sourceLocation: previousLocation,
        destinationOrganization: organization,
        destinationLocation,
        quantity: container.quantity,
        notes: dto.notes ?? null,
      });

      // Re-load final container state so the receipt reflects the saved changes
      const finalContainer = await this.itemService.require(container.qrCode, manager);
      return this.buildReceipt(organization, finalContainer, all, 'received');
    });
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Stock In is exclusively for RETAILER / SHOP.
   *
   * Other organisation types receive stock through the standard Transfer
   * workflow (dispatch / receive) or through production registration.
   */
  private requireTradingOrg(organization: Organization): void {
    if (
      organization.type !== OrganizationType.RETAILER &&
      organization.type !== OrganizationType.SHOP
    ) {
      throw new TraceabilityRuleException(
        'Stock In is only available to RETAILER and SHOP organisations. ' +
          'Other roles receive via the standard transfer workflow.',
      );
    }
  }

  private buildReceipt(
    organization: Organization,
    container: TraceableItem,
    all: TraceableItem[],
    outcome: 'received' | 'idempotent',
  ): StockInReceipt {
    const units = all.filter((i) => i.kind === ItemKind.UNIT);
    // Subtract 1 to exclude the root container itself from the nested count
    const nestedContainers = all.filter((i) => i.kind === ItemKind.PACKAGE && i.id !== container.id);

    return {
      outcome,
      container: {
        id: container.id,
        qrCode: container.qrCode,
        code: container.code,
        packageType: container.packageType,
        sealState: container.sealState,
        quantity: container.quantity,
      },
      receivingOrganizationId: organization.id,
      receivingOrganizationName: organization.name,
      unitCount: units.length,
      nestedContainerCount: nestedContainers.length,
      totalItemsRegistered: all.length,
    };
  }
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface StockInContainerSummary {
  id: number;
  qrCode: string;
  code: string;
  packageType: string | null;
  sealState: string | null;
  quantity: number;
}

export interface StockInPreview {
  container: StockInContainerSummary & {
    holderId: number | null;
    holderName: string | null;
    locationId: number | null;
    locationName: string | null;
    productId: number | null;
    productName: string | null;
  };
  directChildCount: number;
  unitCount: number;
  nestedContainerCount: number;
  /** True if this organisation already holds the container — re-preview after confirm. */
  alreadyHeld: boolean;
}

export interface StockInReceipt {
  outcome: 'received' | 'idempotent';
  container: StockInContainerSummary;
  receivingOrganizationId: number;
  receivingOrganizationName: string;
  unitCount: number;
  nestedContainerCount: number;
  totalItemsRegistered: number;
}

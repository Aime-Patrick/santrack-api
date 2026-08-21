import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { SequenceService } from '../../common/sequence.service';
import { Organization } from '../../organization/entities/organization.entity';
import { Transfer, TransferLine, TransferStatus } from '../../transfer/entities/transfer.entity';
import {
  CancelShipmentDto,
  CreateShipmentDto,
  DeliverShipmentDto,
} from '../dto/shipment.dto';
import { Shipment, ShipmentEvent } from '../entities/shipment.entity';
import { ShipmentEventType, ShipmentStatus, canCancel, canDeliver, canDepart } from '../logistics.enums';
import { Transporter } from '../entities/transporter.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { Driver } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { User } from '../../auth/entities/user.entity';

/**
 * The logistics layer over a dispatch (technical proposal section 5): which
 * transporter, vehicle and driver carried the goods, over which route, and
 * when delivery was confirmed. Custody still moves through the transfer
 * module - dispatch, receipt, cancellation - so the shipment guards its
 * transitions against the transfer's state rather than re-implementing it.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Shipment)
    private readonly shipments: Repository<Shipment>,
    @InjectRepository(ShipmentEvent)
    private readonly events: Repository<ShipmentEvent>,
    @InjectRepository(Transporter)
    private readonly transporters: Repository<Transporter>,
    @InjectRepository(TransferLine)
    private readonly transferLines: Repository<TransferLine>,
    private readonly sequence: SequenceService,
    private readonly recorder: EventRecorder,
  ) {}

  async create(
    organization: Organization,
    actor: User,
    dto: CreateShipmentDto,
  ): Promise<Shipment> {
    return this.dataSource.transaction(async (manager) => {
      const transfer = await manager.findOne(Transfer, {
        where: { id: dto.transferId },
      });
      if (!transfer) {
        throw new NotFoundEntityException('Transfer', dto.transferId);
      }
      if (transfer.sourceOrganization.id !== organization.id) {
        throw new TraceabilityRuleException(
          `Transfer ${transfer.reference} was not dispatched by ${organization.name}`,
        );
      }
      if (transfer.status !== TransferStatus.DISPATCHED) {
        throw new TraceabilityRuleException(
          `Transfer ${transfer.reference} is ${transfer.status}; only an open dispatch can be shipped`,
        );
      }

      const existing = await manager.findOne(Shipment, {
        where: { transfer: { id: transfer.id } },
      });
      if (existing) {
        throw new TraceabilityRuleException(
          `Transfer ${transfer.reference} already has shipment ${existing.shipmentNumber}`,
        );
      }

      const transporter = await this.requireTransporter(manager, organization, dto.transporterId);
      const vehicle = dto.vehicleId
        ? await this.requireVehicle(manager, transporter, dto.vehicleId)
        : null;
      const driver = dto.driverId
        ? await this.requireDriver(manager, transporter, dto.driverId)
        : null;
      const route = dto.routeId
        ? await this.requireRoute(manager, organization, dto.routeId)
        : null;

      const shipmentNumber = await this.nextShipmentNumber(manager);
      const shipment = await manager.save(
        manager.create(Shipment, {
          shipmentNumber,
          organization,
          transfer,
          transporter,
          vehicle,
          driver,
          route,
          destinationOrganization: transfer.destinationOrganization,
          status: ShipmentStatus.PENDING,
          scheduledDepartureOn: dto.scheduledDepartureOn ?? null,
          scheduledDeliveryOn: dto.scheduledDeliveryOn ?? null,
          createdBy: actor,
        }),
      );

      await manager.save(
        manager.create(ShipmentEvent, {
          shipment,
          type: ShipmentEventType.CREATED,
          actor,
          notes: dto.notes ?? null,
        }),
      );

      return shipment;
    });
  }

  /** Puts a booked shipment on the road. */
  async depart(
    organization: Organization,
    actor: User,
    shipmentId: number,
  ): Promise<Shipment> {
    return this.dataSource.transaction(async (manager) => {
      const shipment = await this.requireOwned(manager, organization, shipmentId);
      const transfer = await manager.findOne(Transfer, {
        where: { id: shipment.transfer.id },
      });
      if (transfer?.status === TransferStatus.CANCELLED) {
        throw new TraceabilityRuleException(
          `Transfer ${shipment.transfer.reference} was cancelled; the shipment cannot depart`,
        );
      }
      if (!canDepart(shipment.status)) {
        throw new TraceabilityRuleException(
          `Shipment ${shipment.shipmentNumber} is ${shipment.status} and cannot depart`,
        );
      }

      shipment.status = ShipmentStatus.IN_TRANSIT;
      shipment.departedAt = new Date();
      await manager.save(Shipment, shipment);

      await manager.save(
        manager.create(ShipmentEvent, {
          shipment,
          type: ShipmentEventType.DEPARTED,
          actor,
        }),
      );

      return shipment;
    });
  }

  /**
   * Confirms the goods arrived. Either party may record it - the shipper
   * knows it sent the goods, the destination knows it received them - and the
   * proof-of-delivery details are stamped here.
   */
  async deliver(
    organization: Organization,
    actor: User,
    shipmentId: number,
    dto: DeliverShipmentDto,
  ): Promise<Shipment> {
    return this.dataSource.transaction(async (manager) => {
      const shipment = await this.requireParty(manager, organization, shipmentId);
      const transfer = await manager.findOne(Transfer, {
        where: { id: shipment.transfer.id },
      });
      if (transfer?.status === TransferStatus.CANCELLED) {
        throw new TraceabilityRuleException(
          `Transfer ${shipment.transfer.reference} was cancelled; delivery cannot be confirmed`,
        );
      }
      if (!canDeliver(shipment.status)) {
        throw new TraceabilityRuleException(
          `Shipment ${shipment.shipmentNumber} is ${shipment.status} and cannot be delivered`,
        );
      }

      shipment.status = ShipmentStatus.DELIVERED;
      shipment.deliveredAt = new Date();
      shipment.podRecipientName = dto.recipientName?.trim() || null;
      shipment.podNotes = dto.notes?.trim() || null;
      await manager.save(Shipment, shipment);

      await manager.save(
        manager.create(ShipmentEvent, {
          shipment,
          type: ShipmentEventType.DELIVERED,
          actor,
          notes: shipment.podNotes,
        }),
      );

      // Record a DELIVERED traceability event on each item so the product
      // timeline shows proof-of-delivery separately from custody receipt.
      // POD and receipt are two distinct stages in the proposal.
      if (transfer) {
        // Read through the transaction's manager so the lines and the events
        // written from them come from one consistent view of the data.
        const lines = await manager.find(TransferLine, {
          where: { transfer: { id: transfer.id } },
          relations: { item: true },
        });
        for (const line of lines) {
          await this.recorder.record(manager, {
            item: line.item,
            type: EventType.DELIVERED,
            actor,
            destinationOrganization: transfer.destinationOrganization,
            quantity: line.item.quantity,
            notes: `POD: ${shipment.podRecipientName ?? 'confirmed'} — ${shipment.podNotes ?? ''}`,
          });
        }
      }

      return shipment;
    });
  }

  /** Abandons a shipment before delivery. */
  async cancel(
    organization: Organization,
    actor: User,
    shipmentId: number,
    dto: CancelShipmentDto,
  ): Promise<Shipment> {
    return this.dataSource.transaction(async (manager) => {
      const shipment = await this.requireOwned(manager, organization, shipmentId);
      const transfer = await manager.findOne(Transfer, {
        where: { id: shipment.transfer.id },
      });
      if (transfer?.status === TransferStatus.RECEIVED) {
        throw new TraceabilityRuleException(
          `Transfer ${shipment.transfer.reference} was already received; the shipment cannot be cancelled`,
        );
      }
      if (!canCancel(shipment.status)) {
        throw new TraceabilityRuleException(
          `Shipment ${shipment.shipmentNumber} is ${shipment.status} and cannot be cancelled`,
        );
      }

      shipment.status = ShipmentStatus.CANCELLED;
      await manager.save(Shipment, shipment);

      await manager.save(
        manager.create(ShipmentEvent, {
          shipment,
          type: ShipmentEventType.CANCELLED,
          actor,
          notes: dto.reason.trim(),
        }),
      );

      return shipment;
    });
  }

  async list(
    organization: Organization,
    status: ShipmentStatus | undefined,
    page: number,
    size: number,
  ) {
    const where: Record<string, unknown> = {
      organization: { id: organization.id },
    };
    if (status) {
      where.status = status;
    }
    const [content, total] = await this.shipments.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  /** A shipment is visible to the shipper and the destination party. */
  async get(organization: Organization, shipmentId: number): Promise<Shipment> {
    const shipment = await this.shipments.findOne({ where: { id: shipmentId } });
    if (!shipment) {
      throw new NotFoundEntityException('Shipment', shipmentId);
    }
    const party =
      shipment.organization.id === organization.id ||
      shipment.destinationOrganization?.id === organization.id ||
      organization.type === 'REGULATOR';
    if (!party) {
      throw new NotFoundEntityException('Shipment', shipmentId);
    }
    return shipment;
  }

  /** The append-only tracking history of one shipment. */
  async eventsOf(organization: Organization, shipmentId: number): Promise<ShipmentEvent[]> {
    const shipment = await this.get(organization, shipmentId);
    return this.events.find({
      where: { shipment: { id: shipment.id } },
      order: { recordedAt: 'ASC' },
    });
  }

  private async nextShipmentNumber(manager: EntityManager): Promise<string> {
    const value = await this.sequence.next(manager, 'SHP');
    return `SHP-${String(value).padStart(6, '0')}`;
  }

  private async requireTransporter(
    manager: EntityManager,
    organization: Organization,
    transporterId: number,
  ): Promise<Transporter> {
    const transporter = await manager.findOne(Transporter, { where: { id: transporterId } });
    if (!transporter || transporter.organization.id !== organization.id) {
      throw new NotFoundEntityException('Transporter', transporterId);
    }
    return transporter;
  }

  private async requireVehicle(
    manager: EntityManager,
    transporter: Transporter,
    vehicleId: number,
  ): Promise<Vehicle> {
    const vehicle = await manager.findOne(Vehicle, { where: { id: vehicleId } });
    if (!vehicle || vehicle.transporter.id !== transporter.id) {
      throw new TraceabilityRuleException(
        `Vehicle ${vehicleId} does not belong to transporter ${transporter.name}`,
      );
    }
    return vehicle;
  }

  private async requireDriver(
    manager: EntityManager,
    transporter: Transporter,
    driverId: number,
  ): Promise<Driver> {
    const driver = await manager.findOne(Driver, { where: { id: driverId } });
    if (!driver || driver.transporter.id !== transporter.id) {
      throw new TraceabilityRuleException(
        `Driver ${driverId} does not belong to transporter ${transporter.name}`,
      );
    }
    return driver;
  }

  private async requireRoute(
    manager: EntityManager,
    organization: Organization,
    routeId: number,
  ): Promise<Route> {
    const route = await manager.findOne(Route, { where: { id: routeId } });
    if (!route || route.organization.id !== organization.id) {
      throw new NotFoundEntityException('Route', routeId);
    }
    return route;
  }

  private async requireOwned(
    manager: EntityManager,
    organization: Organization,
    shipmentId: number,
  ): Promise<Shipment> {
    const shipment = await manager.findOne(Shipment, { where: { id: shipmentId } });
    if (!shipment || shipment.organization.id !== organization.id) {
      throw new NotFoundEntityException('Shipment', shipmentId);
    }
    return shipment;
  }

  private async requireParty(
    manager: EntityManager,
    organization: Organization,
    shipmentId: number,
  ): Promise<Shipment> {
    const shipment = await manager.findOne(Shipment, { where: { id: shipmentId } });
    if (!shipment) {
      throw new NotFoundEntityException('Shipment', shipmentId);
    }
    const party =
      shipment.organization.id === organization.id ||
      shipment.destinationOrganization?.id === organization.id;
    if (!party) {
      throw new NotFoundEntityException('Shipment', shipmentId);
    }
    return shipment;
  }
}
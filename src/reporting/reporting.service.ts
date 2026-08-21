import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryService } from '../inventory/services/inventory.service';
import { License } from '../licensing/entities/license.entity';
import { ProductionOrder } from '../manufacturing/entities/production-order.entity';
import { QualityInspection } from '../manufacturing/entities/quality-inspection.entity';
import { RawMaterial } from '../manufacturing/entities/raw-material.entity';
import { Organization } from '../organization/entities/organization.entity';
import { Sale, SaleLine } from '../sale/entities/sale.entity';
import { TraceabilityEvent } from '../traceability/entities/traceability-event.entity';
import { Shipment } from '../logistics/entities/shipment.entity';
import { Batch } from '../batch/entities/batch.entity';
import { Transfer } from '../transfer/entities/transfer.entity';
import { toCsvExport } from './reporting.csv';

/**
 * Reporting (technical proposal section 22): the same records the screens
 * show, flattened into rows an analyst can put in a spreadsheet. Every report
 * is a pure function of module data and stays exportable as CSV.
 */
@Injectable()
export class ReportingService {
  constructor(
    @InjectRepository(License)
    private readonly licenses: Repository<License>,
    @InjectRepository(ProductionOrder)
    private readonly orders: Repository<ProductionOrder>,
    @InjectRepository(QualityInspection)
    private readonly inspections: Repository<QualityInspection>,
    @InjectRepository(RawMaterial)
    private readonly materials: Repository<RawMaterial>,
    @InjectRepository(SaleLine)
    private readonly saleLines: Repository<SaleLine>,
    @InjectRepository(Sale)
    private readonly sales: Repository<Sale>,
    @InjectRepository(TraceabilityEvent)
    private readonly events: Repository<TraceabilityEvent>,
    @InjectRepository(Shipment)
    private readonly shipments: Repository<Shipment>,
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    private readonly inventory: InventoryService,
  ) {}

  /** A report of the requested kind, ready for CSV export. */
  async export(name: string, organization: Organization) {
    const builder = this.builders[name];
    if (!builder) {
      throw new NotFoundException(`Unknown report '${name}'`);
    }
    const rows = await builder.call(this, this, organization);
    return toCsvExport(name, rows);
  }

  /** Rows for one report kind, shared by the JSON and CSV endpoints. */
  async rows(name: string, organization: Organization) {
    const builder = this.builders[name];
    if (!builder) {
      throw new NotFoundException(`Unknown report '${name}'`);
    }
    return builder.call(this, this, organization);
  }

  list() {
    return Object.keys(this.builders);
  }

  private readonly builders: Record<
    string,
    (service: ReportingService, organization: Organization) => Promise<Record<string, unknown>[]>
  > = {
    production: async (service, organization) =>
      (await service.orders.find({ where: { organization: { id: organization.id } } })).map(
        (order) => ({
          orderNumber: order.orderNumber,
          productName: order.product?.name ?? '',
          productSku: order.product?.sku ?? '',
          status: order.status,
          plannedQuantity: order.plannedQuantity,
          producedQuantity: order.producedQuantity,
          startedAt: order.startedAt,
          completedAt: order.completedAt,
          notes: order.notes,
        }),
      ),
    inventory: async (service, organization) => {
      const positions = await service.inventory.positions(organization);
      return positions.map((position) => ({
        productId: position.productId ?? '',
        productName: position.productName ?? '',
        availableUnits: position.availableUnits,
        blockedUnits: position.blockedUnits,
        inTransitUnits: position.inTransitUnits,
      }));
    },
    /**
     * Movements this organization was a party to.
     *
     * The unfiltered `find()` this replaced returned the entire platform's
     * event log to any caller holding VIEW_OPERATIONS - which is every role -
     * so a warehouse officer at one business could read every movement made by
     * every other. Scoping to source or destination matches the chain-of-
     * custody visibility rule the item module already enforces: you see what
     * you handled.
     */
    'stock-movement': async (service, organization) => {
      const events = await service.events
        .createQueryBuilder('e')
        .leftJoinAndSelect('e.item', 'item')
        .leftJoinAndSelect('e.actor', 'actor')
        .leftJoinAndSelect('e.sourceOrganization', 'sourceOrg')
        .leftJoinAndSelect('e.sourceLocation', 'sourceLoc')
        .leftJoinAndSelect('e.destinationOrganization', 'destOrg')
        .leftJoinAndSelect('e.destinationLocation', 'destLoc')
        .where(
          '(e.source_organization_id = :org OR e.destination_organization_id = :org)',
          { org: organization.id },
        )
        .orderBy('e.occurred_at', 'DESC')
        .addOrderBy('e.id', 'DESC')
        .getMany();

      return events.map((event) => ({
        itemId: event.item?.id ?? '',
        eventType: event.type,
        from: event.sourceOrganization?.name ?? event.sourceLocation?.name ?? '',
        to: event.destinationOrganization?.name ?? event.destinationLocation?.name ?? '',
        quantity: event.quantity,
        actor: event.actor?.fullName ?? '',
        at: event.occurredAt,
      }));
    },
    quality: async (service, organization) =>
      (
        await service.inspections.find({
          where: { organization: { id: organization.id } },
        })
      ).map((inspection) => ({
        id: inspection.id,
        orderNumber: inspection.productionOrder?.orderNumber ?? '',
        batchCode: inspection.batch?.batchCode ?? '',
        result: inspection.result,
        testedAt: inspection.testedAt,
        inspector: inspection.inspector?.fullName ?? '',
        notes: inspection.notes,
      })),
    batch: async (service, organization) =>
      (
        await service.batches.find({
          where: { manufacturer: { id: organization.id } },
        })
      ).map((batch) => ({
        batchCode: batch.batchCode,
        productName: batch.product?.name ?? '',
        productSku: batch.product?.sku ?? '',
        status: batch.status,
        manufacturedOn: batch.manufacturedOn,
        expiresOn: batch.expiresOn,
      })),
    shipment: async (service, organization) =>
      (await service.shipments.find({ where: { organization: { id: organization.id } } })).map(
        (shipment) => ({
          shipmentNumber: shipment.shipmentNumber,
          status: shipment.status,
          from: shipment.organization?.name ?? '',
          to: shipment.destinationOrganization?.name ?? '',
          departed: shipment.departedAt,
          delivered: shipment.deliveredAt,
          podRecipient: shipment.podRecipientName ?? '',
        }),
      ),
    // Filtered in SQL rather than by loading every sale line on the platform
    // and discarding other businesses' rows in memory.
    sales: async (service, organization) => {
      const lines = await service.saleLines.find({
        where: { sale: { sellerOrganization: { id: organization.id } } },
        relations: { sale: true, item: { product: true } },
      });
      return lines
        .map((line) => ({
          saleReference: line.sale.reference,
          type: line.sale.type,
          productName: line.item.product?.name ?? '',
          productSku: line.item.product?.sku ?? '',
          quantity: line.quantity,
          soldOn: line.sale.soldAt,
          buyer: line.sale.consumerRef ?? line.sale.buyerOrganization?.name ?? '',
        }));
    },
    transfer: async (service, organization) =>
      (
        await service.transfers.find({
          where: { sourceOrganization: { id: organization.id } },
        })
      ).map((transfer) => ({
        transferReference: transfer.reference,
        status: transfer.status,
        from: transfer.sourceOrganization?.name ?? '',
        to: transfer.destinationOrganization?.name ?? '',
        dispatchedOn: transfer.dispatchedAt,
        receivedOn: transfer.receivedAt,
      })),
    licensing: async (service, organization) =>
      (await service.licenses.find({ where: { organization: { id: organization.id } } })).map(
        (license) => ({
          licenseNumber: license.licenseNumber,
          category: license.category?.code ?? '',
          status: license.status,
          issuedOn: license.issuedOn,
          expiresOn: license.expiresOn,
        }),
      ),
    materials: async (service, organization) =>
      (await service.materials.find({ where: { organization: { id: organization.id } } })).map(
        (material) => ({
          id: material.id,
          name: material.name,
          unitOfMeasure: material.unitOfMeasure,
          unitCost: material.unitCost,
          reorderLevel: material.reorderLevel,
        }),
      ),
  };
}
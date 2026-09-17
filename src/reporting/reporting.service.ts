import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BatchStatus } from '../batch/batch-status.enum';
import { Batch } from '../batch/entities/batch.entity';
import { InventoryService } from '../inventory/services/inventory.service';
import { ComplianceFinding } from '../licensing/entities/compliance-finding.entity';
import { License } from '../licensing/entities/license.entity';
import { RegulatoryCase } from '../licensing/entities/regulatory-case.entity';
import { ProductionOrder } from '../manufacturing/entities/production-order.entity';
import { QualityInspection } from '../manufacturing/entities/quality-inspection.entity';
import { RawMaterial } from '../manufacturing/entities/raw-material.entity';
import { Organization } from '../organization/entities/organization.entity';
import { OrganizationType } from '../organization/organization-type.enum';
import { Sale, SaleLine } from '../sale/entities/sale.entity';
import { TraceabilityEvent } from '../traceability/entities/traceability-event.entity';
import { Shipment } from '../logistics/entities/shipment.entity';
import { Transfer } from '../transfer/entities/transfer.entity';
import { toCsvExport } from './reporting.csv';

/** Commercial / factory-ops reports — trading orgs only. */
const TRADING_ONLY = new Set([
  'production',
  'inventory',
  'sales',
  'materials',
]);

/** Oversight ledger reports — regulators only. */
const REGULATOR_ONLY = new Set(['recalls', 'findings', 'cases']);

/**
 * Reports both audiences may request. Regulators get supervised-industry
 * scope; trading orgs get ActingOrg scope.
 */
const SHARED = new Set([
  'licensing',
  'batch',
  'stock-movement',
  'quality',
  'shipment',
  'transfer',
]);

export type ReportAudience = 'trading' | 'regulator' | 'shared';

export interface ReportDescriptor {
  name: string;
  audience: ReportAudience;
}

/**
 * Reporting (technical proposal section 22): the same records the screens
 * show, flattened into rows an analyst can put in a spreadsheet. Every report
 * is a pure function of module data and stays exportable as CSV.
 *
 * Regulators never receive commercial ledgers (sales, materials cost, factory
 * KPIs). Their exports are scoped to businesses they have licensed.
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
    @InjectRepository(ComplianceFinding)
    private readonly findings: Repository<ComplianceFinding>,
    @InjectRepository(RegulatoryCase)
    private readonly cases: Repository<RegulatoryCase>,
    private readonly inventory: InventoryService,
  ) {}

  list(organization: Organization): string[] {
    if (organization.type === OrganizationType.REGULATOR) {
      return [...SHARED, ...REGULATOR_ONLY];
    }
    return [...SHARED, ...TRADING_ONLY];
  }

  /** A report of the requested kind, ready for CSV export. */
  async export(name: string, organization: Organization) {
    const rows = await this.rows(name, organization);
    return toCsvExport(name, rows);
  }

  /** Rows for one report kind, shared by the JSON and CSV endpoints. */
  async rows(name: string, organization: Organization) {
    this.assertAudience(name, organization);

    if (organization.type === OrganizationType.REGULATOR) {
      const builder = this.regulatorBuilders[name];
      if (!builder) {
        throw new NotFoundException(`Unknown report '${name}'`);
      }
      return builder.call(this, this, organization);
    }

    const builder = this.tradingBuilders[name];
    if (!builder) {
      throw new NotFoundException(`Unknown report '${name}'`);
    }
    return builder.call(this, this, organization);
  }

  private assertAudience(name: string, organization: Organization) {
    const known =
      SHARED.has(name) || TRADING_ONLY.has(name) || REGULATOR_ONLY.has(name);
    if (!known) {
      throw new NotFoundException(`Unknown report '${name}'`);
    }
    if (
      organization.type === OrganizationType.REGULATOR &&
      TRADING_ONLY.has(name)
    ) {
      throw new ForbiddenException(
        'Commercial and factory operations reports are not available to licensing authorities',
      );
    }
    if (
      organization.type !== OrganizationType.REGULATOR &&
      REGULATOR_ONLY.has(name)
    ) {
      throw new ForbiddenException(
        'Oversight reports are available to licensing authorities only',
      );
    }
  }

  /** Distinct businesses holding at least one licence issued by this authority. */
  private async supervisedOrgIds(regulator: Organization): Promise<number[]> {
    const rows = await this.licenses.manager.query<{ id: string | number }[]>(
      `SELECT DISTINCT organization_id AS id
       FROM licenses
       WHERE issued_by_organization_id = $1`,
      [regulator.id],
    );
    return rows
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  private readonly tradingBuilders: Record<
    string,
    (
      service: ReportingService,
      organization: Organization,
    ) => Promise<Record<string, unknown>[]>
  > = {
    production: async (service, organization) =>
      (
        await service.orders.find({
          where: { organization: { id: organization.id } },
        })
      ).map((order) => ({
        orderNumber: order.orderNumber,
        productName: order.product?.name ?? '',
        productSku: order.product?.sku ?? '',
        status: order.status,
        plannedQuantity: order.plannedQuantity,
        producedQuantity: order.producedQuantity,
        startedAt: order.startedAt,
        completedAt: order.completedAt,
        notes: order.notes,
      })),
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
     * Scoped to source or destination so a warehouse officer at one business
     * cannot read every movement made by every other.
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
        from:
          event.sourceOrganization?.name ?? event.sourceLocation?.name ?? '',
        to:
          event.destinationOrganization?.name ??
          event.destinationLocation?.name ??
          '',
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
      (
        await service.shipments.find({
          where: { organization: { id: organization.id } },
        })
      ).map((shipment) => ({
        shipmentNumber: shipment.shipmentNumber,
        status: shipment.status,
        from: shipment.organization?.name ?? '',
        to: shipment.destinationOrganization?.name ?? '',
        departed: shipment.departedAt,
        delivered: shipment.deliveredAt,
        podRecipient: shipment.podRecipientName ?? '',
      })),
    sales: async (service, organization) => {
      const lines = await service.saleLines.find({
        where: { sale: { sellerOrganization: { id: organization.id } } },
        relations: { sale: true, item: { product: true } },
      });
      return lines.map((line) => ({
        saleReference: line.sale.reference,
        type: line.sale.type,
        productName: line.item.product?.name ?? '',
        productSku: line.item.product?.sku ?? '',
        quantity: line.quantity,
        soldOn: line.sale.soldAt,
        buyer:
          line.sale.consumerRef ?? line.sale.buyerOrganization?.name ?? '',
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
      (
        await service.licenses.find({
          where: { organization: { id: organization.id } },
        })
      ).map((license) => ({
        licenseNumber: license.licenseNumber,
        category: license.category?.code ?? '',
        status: license.status,
        issuedOn: license.issuedOn,
        expiresOn: license.expiresOn,
      })),
    materials: async (service, organization) =>
      (
        await service.materials.find({
          where: { organization: { id: organization.id } },
        })
      ).map((material) => ({
        id: material.id,
        name: material.name,
        unitOfMeasure: material.unitOfMeasure,
        unitCost: material.unitCost,
        reorderLevel: material.reorderLevel,
      })),
  };

  private readonly regulatorBuilders: Record<
    string,
    (
      service: ReportingService,
      organization: Organization,
    ) => Promise<Record<string, unknown>[]>
  > = {
    licensing: async (service, organization) =>
      (
        await service.licenses.find({
          where: { issuedBy: { id: organization.id } },
          relations: { organization: true, category: true, facility: true },
        })
      ).map((license) => ({
        licenseNumber: license.licenseNumber,
        organization: license.organization?.name ?? '',
        organizationType: license.organization?.type ?? '',
        category: license.category?.name ?? license.category?.code ?? '',
        activity: license.category?.activity ?? '',
        facility: license.facility?.name ?? '',
        status: license.status,
        issuedOn: license.issuedOn,
        expiresOn: license.expiresOn,
        statusReason: license.statusReason ?? '',
      })),

    batch: async (service, organization) => {
      const ids = await service.supervisedOrgIds(organization);
      if (ids.length === 0) return [];
      const batches = await service.batches.find({
        where: { manufacturer: { id: In(ids) } },
        relations: { product: true, manufacturer: true },
      });
      return batches.map((batch) => ({
        batchCode: batch.batchCode,
        manufacturer: batch.manufacturer?.name ?? '',
        productName: batch.product?.name ?? '',
        productSku: batch.product?.sku ?? '',
        status: batch.status,
        manufacturedOn: batch.manufacturedOn,
        expiresOn: batch.expiresOn,
      }));
    },

    'stock-movement': async (service, organization) => {
      const ids = await service.supervisedOrgIds(organization);
      if (ids.length === 0) return [];
      const events = await service.events
        .createQueryBuilder('e')
        .leftJoinAndSelect('e.item', 'item')
        .leftJoinAndSelect('e.actor', 'actor')
        .leftJoinAndSelect('e.sourceOrganization', 'sourceOrg')
        .leftJoinAndSelect('e.sourceLocation', 'sourceLoc')
        .leftJoinAndSelect('e.destinationOrganization', 'destOrg')
        .leftJoinAndSelect('e.destinationLocation', 'destLoc')
        .where(
          '(e.source_organization_id IN (:...ids) OR e.destination_organization_id IN (:...ids))',
          { ids },
        )
        .orderBy('e.occurred_at', 'DESC')
        .addOrderBy('e.id', 'DESC')
        .take(2000)
        .getMany();

      return events.map((event) => ({
        itemId: event.item?.id ?? '',
        eventType: event.type,
        from:
          event.sourceOrganization?.name ?? event.sourceLocation?.name ?? '',
        to:
          event.destinationOrganization?.name ??
          event.destinationLocation?.name ??
          '',
        quantity: event.quantity,
        actor: event.actor?.fullName ?? '',
        at: event.occurredAt,
      }));
    },

    quality: async (service, organization) => {
      const ids = await service.supervisedOrgIds(organization);
      if (ids.length === 0) return [];
      const inspections = await service.inspections.find({
        where: { organization: { id: In(ids) } },
        relations: {
          organization: true,
          productionOrder: true,
          batch: true,
          inspector: true,
        },
      });
      return inspections.map((inspection) => ({
        organization: inspection.organization?.name ?? '',
        orderNumber: inspection.productionOrder?.orderNumber ?? '',
        batchCode: inspection.batch?.batchCode ?? '',
        result: inspection.result,
        testedAt: inspection.testedAt,
        inspector: inspection.inspector?.fullName ?? '',
        notes: inspection.notes,
      }));
    },

    shipment: async (service, organization) => {
      const ids = await service.supervisedOrgIds(organization);
      if (ids.length === 0) return [];
      const shipments = await service.shipments
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.organization', 'org')
        .leftJoinAndSelect('s.destinationOrganization', 'dest')
        .where(
          '(s.organization_id IN (:...ids) OR s.destination_organization_id IN (:...ids))',
          { ids },
        )
        .orderBy('s.id', 'DESC')
        .take(2000)
        .getMany();
      return shipments.map((shipment) => ({
        shipmentNumber: shipment.shipmentNumber,
        status: shipment.status,
        from: shipment.organization?.name ?? '',
        to: shipment.destinationOrganization?.name ?? '',
        departed: shipment.departedAt,
        delivered: shipment.deliveredAt,
      }));
    },

    transfer: async (service, organization) => {
      const ids = await service.supervisedOrgIds(organization);
      if (ids.length === 0) return [];
      const transfers = await service.transfers
        .createQueryBuilder('t')
        .leftJoinAndSelect('t.sourceOrganization', 'src')
        .leftJoinAndSelect('t.destinationOrganization', 'dest')
        .where(
          '(t.source_organization_id IN (:...ids) OR t.destination_organization_id IN (:...ids))',
          { ids },
        )
        .orderBy('t.id', 'DESC')
        .take(2000)
        .getMany();
      return transfers.map((transfer) => ({
        transferReference: transfer.reference,
        status: transfer.status,
        from: transfer.sourceOrganization?.name ?? '',
        to: transfer.destinationOrganization?.name ?? '',
        dispatchedOn: transfer.dispatchedAt,
        receivedOn: transfer.receivedAt,
      }));
    },

    recalls: async (service, organization) => {
      const ids = await service.supervisedOrgIds(organization);
      if (ids.length === 0) return [];
      const batches = await service.batches.find({
        where: {
          status: BatchStatus.RECALLED,
          manufacturer: { id: In(ids) },
        },
        relations: { product: true, manufacturer: true },
      });
      return batches.map((batch) => ({
        batchCode: batch.batchCode,
        manufacturer: batch.manufacturer?.name ?? '',
        productName: batch.product?.name ?? '',
        productSku: batch.product?.sku ?? '',
        status: batch.status,
        reason: batch.statusReason ?? '',
        recalledAt: batch.statusChangedAt,
        manufacturedOn: batch.manufacturedOn,
        expiresOn: batch.expiresOn,
      }));
    },

    findings: async (service, organization) => {
      const ids = await service.supervisedOrgIds(organization);
      if (ids.length === 0) return [];
      const findings = await service.findings.find({
        where: { organization: { id: In(ids) } },
        relations: { organization: true, license: true, actor: true },
        order: { recordedAt: 'DESC' },
        take: 2000,
      });
      return findings.map((finding) => ({
        organization: finding.organization?.name ?? '',
        type: finding.type,
        activity: finding.activity ?? '',
        action: finding.action,
        licenseNumber: finding.license?.licenseNumber ?? '',
        detail: finding.detail ?? '',
        actor: finding.actor?.fullName ?? '',
        recordedAt: finding.recordedAt,
      }));
    },

    cases: async (service, organization) => {
      const cases = await service.cases
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.organization', 'org')
        .leftJoinAndSelect('c.leadAuthority', 'auth')
        .leftJoinAndSelect('auth.operatingOrganization', 'opOrg')
        .leftJoinAndSelect('c.assignedTo', 'assignee')
        .leftJoinAndSelect('c.license', 'lic')
        .leftJoinAndSelect('c.batch', 'batch')
        .where('opOrg.id = :orgId', { orgId: organization.id })
        .orderBy('c.opened_at', 'DESC')
        .take(2000)
        .getMany();
      return cases.map((caseRecord) => ({
        caseNumber: caseRecord.caseNumber ?? '',
        title: caseRecord.title,
        organization: caseRecord.organization?.name ?? '',
        category: caseRecord.caseCategory ?? '',
        priority: caseRecord.priority,
        status: caseRecord.status,
        dueOn: caseRecord.dueOn,
        assignedTo: caseRecord.assignedTo?.fullName ?? '',
        licenseNumber: caseRecord.license?.licenseNumber ?? '',
        batchCode: caseRecord.batch?.batchCode ?? '',
        openedAt: caseRecord.openedAt,
      }));
    },
  };
}

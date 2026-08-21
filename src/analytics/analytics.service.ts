import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TraceabilityRuleException } from '../common/errors';
import { InventoryService } from '../inventory/services/inventory.service';
import { TraceableItem } from '../item/entities/traceable-item.entity';
import { ItemStatus } from '../item/item.enums';
import { License, LicenseCategory } from '../licensing/entities/license.entity';
import { LicenseStatus } from '../licensing/licensing.enums';
import { ProductionOrder } from '../manufacturing/entities/production-order.entity';
import { RawMaterial } from '../manufacturing/entities/raw-material.entity';
import { QualityInspection } from '../manufacturing/entities/quality-inspection.entity';
import { Organization } from '../organization/entities/organization.entity';
import { OrganizationType } from '../organization/organization-type.enum';
import { Employee } from '../payroll/entities/employee.entity';
import { EmployeeStatus } from '../payroll/payroll.enums';
import { Product } from '../product/entities/product.entity';
import { Sale, SaleLine } from '../sale/entities/sale.entity';
import { TraceabilityEvent } from '../traceability/entities/traceability-event.entity';
import { Transfer, TransferLine, TransferStatus } from '../transfer/entities/transfer.entity';
import { Invoice } from '../commerce/entities/invoice.entity';
import { Payment } from '../commerce/entities/payment.entity';
import { InvoiceStatus } from '../commerce/commerce.enums';
import { JournalLine } from '../finance/entities/journal.entity';
import { AccountType } from '../finance/finance.enums';
import { PayrollLine, PayrollRun } from '../payroll/entities/payroll.entity';
import { SaleType } from '../sale/entities/sale.entity';
import { User } from '../auth/entities/user.entity';
import { dailySeries, dayBuckets, round2, stockOutCount } from './analytics';

/**
 * Executive intelligence & analytics (technical proposal section 10): the
 * management dashboard. Every number is derived from the modules that record
 * the fact - production, inventory, sales, finance, licensing - so what the
 * dashboard shows and what the operational screens prove are the same figures.
 */
@Injectable()
export class AnalyticsService {
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
    @InjectRepository(TraceabilityEvent)
    private readonly events: Repository<TraceabilityEvent>,
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    @InjectRepository(TransferLine)
    private readonly transferLines: Repository<TransferLine>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PayrollRun)
    private readonly payroll: Repository<PayrollRun>,
    @InjectRepository(PayrollLine)
    private readonly payrollLinesRepo: Repository<PayrollLine>,
    @InjectRepository(JournalLine)
    private readonly journalLines: Repository<JournalLine>,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly inventory: InventoryService,
  ) {}

  /** The four proposal dimensions in one call for a management dashboard. */
  async executive(organization: Organization) {
    const [industry, supplyChain, market, finance, compliance] = await Promise.all([
      this.industry(organization),
      this.supplyChain(organization),
      this.market(organization),
      this.finance(organization),
      this.compliance(organization),
    ]);
    return { industry, supplyChain, market, finance, compliance };
  }

  /** Aggregate counts for role-based KPIs across the platform. */
  async counts(organization: Organization) {
    const [totalUsers, totalProducts, totalEmployees] = await Promise.all([
      this.users.count(),
      this.products.count(),
      this.employees.count({ where: { active: true, status: EmployeeStatus.ACTIVE } }),
    ]);

    return {
      totalUsers,
      totalProducts,
      totalEmployees,
    };
  }

  /** Production trend data for the dashboard chart — completed orders grouped by completion date. */
  async productionTrend(organization: Organization) {
    const orders = await this.orders.find({
      where: { organization: { id: organization.id } },
      order: { completedAt: 'ASC' },
    });

    // Group by completion date (day)
    const byDay = new Map<string, { produced: number; target: number }>();
    for (const order of orders) {
      if (!order.completedAt) continue;
      const day = order.completedAt.toISOString().slice(0, 10);
      const current = byDay.get(day) ?? { produced: 0, target: 0 };
      current.produced += order.producedQuantity ?? 0;
      current.target += order.plannedQuantity ?? 0;
      byDay.set(day, current);
    }

    // Convert to array and fill gaps for the last 90 days
    const today = new Date();
    const result: Array<{ date: string; label: string; produced: number; target: number }> = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const data = byDay.get(dayStr);
      result.push({
        date: dayStr,
        label,
        produced: data?.produced ?? 0,
        target: data?.target ?? 0,
      });
    }

    return result;
  }

  /** Licensed industries and active/inactive licenses. */
  async industry(organization: Organization) {
    const licenses = await this.licenses.find({
      where: { organization: { id: organization.id } },
      relations: { category: true },
    });
    const active = licenses.filter(
      (license) =>
        license.status === LicenseStatus.ACTIVE &&
        license.isWithinDates(new Date().toISOString().slice(0, 10)),
    );
    return {
      licensedIndustries: [...new Set(active.map((license) => license.category.code))].length,
      activeLicenses: active.length,
      inactiveLicenses: licenses.length - active.length,
      totalLicenses: licenses.length,
    };
  }

  /**
   * Organizations grouped by type with employee counts - the section 10
   * "Industry" panel of the regulator's dashboard.
   *
   * Regulator-only. The figures span every business on the platform, so
   * leaving this on VIEW_OPERATIONS (which every role holds) published the
   * platform's composition and total headcount by sector to each of its
   * tenants.
   */
  async industryCategories(organization: Organization) {
    if (organization.type !== OrganizationType.REGULATOR) {
      throw new TraceabilityRuleException(
        'Cross-industry figures are available to licensing authorities only',
      );
    }

    const orgs = await this.organizations.find();
    const employees = await this.employees.find({
      where: { active: true, status: EmployeeStatus.ACTIVE },
      relations: { organization: true },
    });

    const employeeCounts = new Map<number, number>();
    for (const emp of employees) {
      employeeCounts.set(emp.organization.id, (employeeCounts.get(emp.organization.id) ?? 0) + 1);
    }

    const groups = new Map<string, { count: number; totalEmployees: number }>();
    for (const org of orgs) {
      const current = groups.get(org.type) ?? { count: 0, totalEmployees: 0 };
      current.count += 1;
      current.totalEmployees += employeeCounts.get(org.id) ?? 0;
      groups.set(org.type, current);
    }

    return [...groups.entries()].map(([category, data]) => ({
      category,
      count: data.count,
      totalEmployees: data.totalEmployees,
    }));
  }

  /** Raw-material availability, inventory value, in transit, stock-outs. */
  async supplyChain(organization: Organization) {
    const positions = await this.inventory.positions(organization);
    const availableUnits = positions.reduce((n, p) => n + p.availableUnits, 0);

    const [materials, transfers, transferLines] = await Promise.all([
      this.materials.find({
        where: { organization: { id: organization.id } },
      }),
      this.transfers.find({
        where: { sourceOrganization: { id: organization.id } },
      }),
      // Only this organization's dispatches. The unfiltered version loaded
      // every transfer line on the platform to sum a handful of them.
      this.transferLines
        .createQueryBuilder('line')
        .innerJoinAndSelect('line.transfer', 'transfer')
        .where('transfer.source_organization_id = :org', { org: organization.id })
        .getMany(),
    ]);

    const inTransit = transfers.filter(
      (transfer) => transfer.status === TransferStatus.DISPATCHED,
    );
    const inTransitUnits = inTransit.reduce(
      (n, transfer) =>
        n +
        transferLines
          .filter((line) => line.transfer.id === transfer.id)
          .reduce((m, line) => m + line.item.quantity, 0),
      0,
    );

    /**
     * Materials with a reorder level configured.
     *
     * This is NOT "materials below their reorder level", which is what the
     * field it replaced ("lowRawMaterials") claimed to report. Raw-material
     * stock is not tracked yet - there is no on-hand quantity anywhere in the
     * schema to compare a threshold against - so the old figure only ever
     * counted how many materials someone had bothered to set a level on, and
     * read as a shortage warning on the dashboard.
     *
     * Reported honestly here until receiving and issuing move real quantities;
     * at that point this becomes a genuine comparison.
     */
    const materialsWithReorderLevel = materials.filter(
      (material) => parseFloat(material.reorderLevel) > 0,
    );

    return {
      availableUnits,
      distinctProducts: positions.length,
      stockOutProducts: stockOutCount(
        positions.map((p) => ({
          productId: p.productId ?? 0,
          availableUnits: p.availableUnits,
        })),
      ),
      inTransitUnits,
      inTransitShipments: inTransit.length,
      rawMaterialCount: materials.length,
      materialsWithReorderLevel: materialsWithReorderLevel.length,
      // Raw-material stock is not tracked yet, so a shortage count would be a
      // guess. Null says "not measured"; zero would say "nothing is short".
      lowRawMaterials: null,
      distributionVolumes: transfers.filter((t) => t.status === TransferStatus.RECEIVED).length,
    };
  }

  /** Sales by product, customer distribution, demand over the year. */
  async market(organization: Organization) {
    // Scoped in SQL. Loading every sale line on the platform and dropping the
    // other businesses' rows afterwards got slower for everyone each time any
    // one tenant made a sale.
    const salesHere = await this.saleLines.find({
      where: { sale: { sellerOrganization: { id: organization.id } } },
      relations: { sale: true, item: { product: true } },
    });

    const byProduct = new Map<string, { productId: number; productName: string; units: number }>();
    for (const line of salesHere) {
      const key = `${line.item.product?.id ?? 0}`;
      const current = byProduct.get(key) ?? {
        productId: line.item.product?.id ?? 0,
        productName: line.item.product?.name ?? 'Unknown',
        units: 0,
      };
      current.units += line.quantity;
      byProduct.set(key, current);
    }
    const products = [...byProduct.values()].sort((a, b) => b.units - a.units);

    const buckets = dayBuckets(new Date().toISOString().slice(0, 10), 365);
    const revenue = await this.revenueSeries(organization, buckets);
    const consumerDemand = salesHere.filter(
      (line) => line.sale.type === SaleType.CONSUMER,
    ).length;

    return {
      productsSold: salesHere.reduce((n, line) => n + line.quantity, 0),
      revenueSeries: revenue,
      topProducts: products.slice(0, 10),
      consumerSales: consumerDemand,
    };
  }

  /** Revenue, receivables, expenses and payroll cost from the ledgers. */
  async finance(organization: Organization) {
    const [invoices, payments, payroll, journalLines] = await Promise.all([
      this.invoices.find({ where: { organization: { id: organization.id } } }),
      this.payments.find({ where: { organization: { id: organization.id } } }),
      this.payroll.find({ where: { organization: { id: organization.id } } }),
      this.journalLines
        .createQueryBuilder('line')
        .innerJoinAndSelect('line.entry', 'entry')
        .innerJoinAndSelect('line.account', 'account')
        .getMany(),
    ]);

    const revenue = invoices.reduce(
      (sum, invoice) => sum + (parseFloat(invoice.totalAmount ?? '0') || 0),
      0,
    );
    const received = payments.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
    const receivables = revenue - received;

    const expenses = journalLines
      .filter((line) => line.account.type === AccountType.EXPENSE)
      .reduce(
        (sum, line) => sum + (parseFloat(line.debit) - parseFloat(line.credit)),
        0,
      );

    const payrollCost = (
    await this.payrollLinesRepo
      .createQueryBuilder('line')
      .innerJoin('line.run', 'run')
      .innerJoin('run.organization', 'org', 'org.id = :orgId', {
        orgId: organization.id,
      })
      .getMany()
  ).reduce((sum, line) => sum + parseFloat(line.gross), 0);

    return {
      revenue: round2(revenue),
      receivables: round2(Math.max(receivables, 0)),
      outstandingReceivables: round2(Math.max(receivables, 0)),
      expenses: round2(expenses),
      payrollCost: round2(payrollCost),
      netProfit: round2(revenue - expenses - payrollCost),
      openInvoices: invoices.filter((invoice) => invoice.status === InvoiceStatus.ISSUED).length,
    };
  }

  /** License status, traceability gaps, inspection findings and recalls. */
  async compliance(organization: Organization) {
    const licenses = await this.licenses.find({
      where: { organization: { id: organization.id } },
    });
    const today = new Date().toISOString().slice(0, 10);

    const [inspections, items, completedOrders] = await Promise.all([
      this.inspections.find({ where: { organization: { id: organization.id } } }),
      this.itemsByOrg(organization),
      this.orders.find({
        where: { organization: { id: organization.id } },
        relations: { batch: true },
      }),
    ]);

    const findings = inspections.reduce(
      (counts, inspection) => {
        counts[inspection.result] = (counts[inspection.result] ?? 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    );

    // The cumulative cap: total produced minus total registered across all
    // production orders that have been completed with a batch. A positive
    // number means there are finished goods not yet given product identities.
    let unregisteredProducts = 0;
    for (const order of completedOrders) {
      if (!order.batch || order.producedQuantity <= 0) continue;
      const registered = items.filter(
        (item) => item.batch?.id === order.batch!.id,
      ).length;
      unregisteredProducts += Math.max(0, order.producedQuantity - registered);
    }

    return {
      activeLicenses: licenses.filter((l) => l.status === LicenseStatus.ACTIVE).length,
      expiredLicenses: licenses.filter(
        (l) => l.expiresOn && l.expiresOn < today && l.status === LicenseStatus.ACTIVE,
      ).length,
      pendingReviews: licenses.filter((l) => l.status === LicenseStatus.SUBMITTED).length,
      recalledItems: items.filter((item) => item.status === ItemStatus.RECALLED).length,
      recalledBatches: 0, // recall state lives on batches; surfaced per item
      inspectionFindings: findings,
      quarantinedItems: items.filter((item) => item.status === ItemStatus.QUARANTINED).length,
      unregisteredProducts,
    };
  }

  private async revenueSeries(organization: Organization, buckets: { day: string; label: string }[]) {
    const invoices = await this.invoices.find({
      where: { organization: { id: organization.id } },
    });
    return dailySeries(
      buckets,
      invoices
        .filter((invoice) => invoice.issuedOn)
        .map((invoice) => ({
          date: invoice.issuedOn as string,
          amount: parseFloat(invoice.totalAmount ?? '0') || 0,
        })),
    );
  }

  private async itemsByOrg(organization: Organization): Promise<TraceableItem[]> {
    return this.items.find({
      where: { holder: { id: organization.id } },
    });
  }
}
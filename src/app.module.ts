import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import configuration from './config/configuration';
import { ENTITIES, dataSourceOptions } from './config/data-source';
import { HealthController } from './health.controller';

import { EmailModule } from './email/email.module';
import { NotificationsModule } from './notifications/notifications.module';

import { AuthController } from './auth/controllers/auth.controller';
import { UserController } from './auth/controllers/user-management.controller';
import { User } from './auth/entities/user.entity';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AuthService } from './auth/services/auth.service';
import { UserManagementService } from './auth/services/user-management.service';

import { BatchController } from './batch/controllers/batch.controller';
import { Batch } from './batch/entities/batch.entity';
import { BatchService } from './batch/services/batch.service';

import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';

import { InventoryController } from './inventory/controllers/inventory.controller';
import { InventoryService } from './inventory/services/inventory.service';

import { IdentityPoolController } from './item/controllers/identity-pool.controller';
import { ItemController } from './item/controllers/item.controller';
import { CodeSequence } from './item/entities/code-sequence.entity';
import { TraceableItem } from './item/entities/traceable-item.entity';
import { IdentityPoolService } from './item/services/identity-pool.service';
import { ItemCodeGenerator } from './item/services/item-code-generator.service';
import { ItemService } from './item/services/item.service';
import { LifecycleService } from './item/services/lifecycle.service';

import { LocationController } from './location/controllers/location.controller';
import { Location } from './location/entities/location.entity';
import { LocationService } from './location/services/location.service';

import { BomController } from './manufacturing/controllers/bom.controller';
import { MachineController } from './manufacturing/controllers/machine.controller';
import { ProductionController } from './manufacturing/controllers/production.controller';
import { QualityInspectionController } from './manufacturing/controllers/quality-inspection.controller';
import { RawMaterialController } from './manufacturing/controllers/raw-material.controller';
import {
  BillOfMaterial,
  BillOfMaterialLine,
} from './manufacturing/entities/bill-of-material.entity';
import { Machine } from './manufacturing/entities/machine.entity';
import { ProductionEvent } from './manufacturing/entities/production-event.entity';
import {
  ProductionOrder,
  ProductionOrderMaterial,
} from './manufacturing/entities/production-order.entity';
import { QualityInspection } from './manufacturing/entities/quality-inspection.entity';
import { RawMaterial } from './manufacturing/entities/raw-material.entity';
import { BomService } from './manufacturing/services/bom.service';
import { MachineService } from './manufacturing/services/machine.service';
import { ProductionService } from './manufacturing/services/production.service';
import { QualityInspectionService } from './manufacturing/services/quality-inspection.service';
import { RawMaterialService } from './manufacturing/services/raw-material.service';
import { LicenseEnforcementService } from './licensing/services/license-enforcement.service';
import { ProductionEligibilityService } from './licensing/services/production-eligibility.service';
import { ComplianceOverviewService } from './licensing/services/compliance-overview.service';

import { CustomerController } from './commerce/controllers/customer.controller';
import { InvoiceController } from './commerce/controllers/invoice.controller';
import { QuotationController } from './commerce/controllers/quotation.controller';
import { SalesOrderController } from './commerce/controllers/sales-order.controller';
import { SalesReturnController } from './commerce/controllers/sales-return.controller';
import { Customer } from './commerce/entities/customer.entity';
import { Invoice } from './commerce/entities/invoice.entity';
import { Payment } from './commerce/entities/payment.entity';
import { Quotation, QuotationLine } from './commerce/entities/quotation.entity';
import { SalesReturn } from './commerce/entities/sales-return.entity';
import { SalesOrder, SalesOrderLine } from './commerce/entities/sales-order.entity';
import { SalesOrderReservation } from './commerce/entities/sales-order-reservation.entity';
import { CustomerService } from './commerce/services/customer.service';
import { InvoiceService } from './commerce/services/invoice.service';
import { QuotationService } from './commerce/services/quotation.service';
import { SalesOrderService } from './commerce/services/sales-order.service';
import { SalesReturnService } from './commerce/services/sales-return.service';

import { SupplierController } from './purchasing/controllers/supplier.controller';
import { PurchaseOrderController } from './purchasing/controllers/purchase-order.controller';
import { Supplier } from './purchasing/entities/supplier.entity';
import {
  PurchaseOrder,
  PurchaseOrderLine,
} from './purchasing/entities/purchase-order.entity';
import { SupplierService } from './purchasing/services/supplier.service';
import { PurchaseOrderService } from './purchasing/services/purchase-order.service';

import { AccountController } from './finance/controllers/account.controller';
import { BudgetController } from './finance/controllers/budget.controller';
import { CostCentreController } from './finance/controllers/cost-centre.controller';
import { FinanceReportController } from './finance/controllers/finance-report.controller';
import { JournalController } from './finance/controllers/journal.controller';
import { Account } from './finance/entities/account.entity';
import { Budget } from './finance/entities/budget.entity';
import { CostCentre } from './finance/entities/cost-centre.entity';
import { JournalEntry, JournalLine } from './finance/entities/journal.entity';
import { AccountService } from './finance/services/account.service';
import { BudgetService } from './finance/services/budget.service';
import { CostCentreService } from './finance/services/cost-centre.service';
import { FinanceReportService } from './finance/services/finance-report.service';
import { JournalService } from './finance/services/journal.service';

import { AttendanceController } from './payroll/controllers/attendance.controller';
import { DepartmentController } from './payroll/controllers/department.controller';
import { EmployeeController } from './payroll/controllers/employee.controller';
import { JobPositionController } from './payroll/controllers/job-position.controller';
import { LeaveController } from './payroll/controllers/leave.controller';
import { PayrollReportController } from './payroll/controllers/payroll-report.controller';
import { PayrollRunController } from './payroll/controllers/payroll-run.controller';
import { Attendance } from './payroll/entities/attendance.entity';
import { Department } from './payroll/entities/department.entity';
import { Employee } from './payroll/entities/employee.entity';
import { EmployeePayItem } from './payroll/entities/employee-pay-item.entity';
import { JobPosition } from './payroll/entities/job-position.entity';
import { Leave } from './payroll/entities/leave.entity';
import { PayrollLine, PayrollRun } from './payroll/entities/payroll.entity';
import { AttendanceService } from './payroll/services/attendance.service';
import { DepartmentService } from './payroll/services/department.service';
import { EmployeeService } from './payroll/services/employee.service';
import { JobPositionService } from './payroll/services/job-position.service';
import { LeaveService } from './payroll/services/leave.service';
import { PayrollReportService } from './payroll/services/payroll-report.service';
import { PayrollService } from './payroll/services/payroll.service';

import { DriverController } from './logistics/controllers/driver.controller';
import { RouteController } from './logistics/controllers/route.controller';
import { ShipmentController } from './logistics/controllers/shipment.controller';
import { TransporterController } from './logistics/controllers/transporter.controller';
import { VehicleController } from './logistics/controllers/vehicle.controller';
import { Driver } from './logistics/entities/driver.entity';
import { Route } from './logistics/entities/route.entity';
import { Shipment, ShipmentEvent } from './logistics/entities/shipment.entity';
import { Transporter } from './logistics/entities/transporter.entity';
import { Vehicle } from './logistics/entities/vehicle.entity';
import { DriverService } from './logistics/services/driver.service';
import { RouteService } from './logistics/services/route.service';
import { ShipmentService } from './logistics/services/shipment.service';
import { TransporterService } from './logistics/services/transporter.service';
import { VehicleService } from './logistics/services/vehicle.service';

import { FacilityController } from './organization/controllers/facility.controller';
import { OrganizationController } from './organization/controllers/organization.controller';
import { Organization } from './organization/entities/organization.entity';
import { OrganizationService } from './organization/services/organization.service';
import { FacilityService } from './organization/services/facility.service';

import { ProductController } from './product/controllers/product.controller';
import { BrandController } from './product/controllers/brand.controller';
import { ProductCategoryController } from './product/controllers/product-category.controller';
import { PublicCategoryController } from './product/controllers/public-category.controller';
import { CategoryShareService } from './product/services/category-share.service';
import { Product } from './product/entities/product.entity';
import { ProductService } from './product/services/product.service';

import {
  LicenseController,
  LicenseReviewController,
} from './licensing/controllers/license.controller';
import { ProductionEligibilityController } from './licensing/controllers/production-eligibility.controller';
import { ComplianceOverviewController } from './licensing/controllers/compliance-overview.controller';
import { RegulatoryCaseController } from './licensing/controllers/regulatory-case.controller';
import { RegulatoryCaseResponseController } from './licensing/controllers/regulatory-case-response.controller';
import { RegulatoryInspectionController } from './licensing/controllers/regulatory-inspection.controller';
import { PublicComplaintController } from './licensing/controllers/public-complaint.controller';
import { RegulatoryComplaintController } from './licensing/controllers/regulatory-complaint.controller';
import { RegulatorySignalController } from './licensing/controllers/regulatory-signal.controller';
import { RegulatoryCommandController } from './licensing/controllers/regulatory-command.controller';
import { RegulatoryAuthorityController } from './licensing/controllers/regulatory-authority.controller';
import { RegulatoryAccountabilityController } from './licensing/controllers/regulatory-accountability.controller';
import { RegulatoryAccountabilityService } from './licensing/services/regulatory-accountability.service';
import { RegulatoryReferralController } from './licensing/controllers/regulatory-referral.controller';
import { RegulatoryOversightController } from './licensing/controllers/regulatory-oversight.controller';
import { LicenseService } from './licensing/services/license.service';
import { RegulatoryCaseService } from './licensing/services/regulatory-case.service';
import { RegulatoryCaseDeadlineService } from './licensing/services/regulatory-case-deadline.service';
import { RegulatoryInvestigationPackService } from './licensing/services/regulatory-investigation-pack.service';
import { RegulatoryInspectionService } from './licensing/services/regulatory-inspection.service';
import { PublicComplaintService } from './licensing/services/public-complaint.service';
import { RegulatorySignalService } from './licensing/services/regulatory-signal.service';
import { RegulatoryCommandService } from './licensing/services/regulatory-command.service';
import { RegulatoryAuthorityService } from './licensing/services/regulatory-authority.service';
import { RegulatoryOversightService } from './licensing/services/regulatory-oversight.service';
import { RegulatoryAuthority } from './licensing/entities/regulatory-authority.entity';
import { SequenceService } from './common/sequence.service';
import { StorageModule } from './storage/storage.module';
import { BarcodeController } from './barcode/barcode.controller';
import { ScanController } from './scan/scan.controller';
import { ScanService } from './scan/scan.service';
import { BarcodeService } from './barcode/barcode.service';
import { QrCodeService } from './qr/qr-code.service';

import { RecallController } from './recall/controllers/recall.controller';
import { RecallService } from './recall/services/recall.service';

import { SaleController } from './sale/controllers/sale.controller';
import { Sale, SaleLine } from './sale/entities/sale.entity';
import { SaleService } from './sale/services/sale.service';

import {
  TraceController,
  VerificationController,
} from './traceability/controllers/trace.controller';
import { TraceabilityEvent } from './traceability/entities/traceability-event.entity';
import { EventRecorder } from './traceability/services/event-recorder.service';
import { TraceabilityService } from './traceability/services/traceability.service';

import { TransferController } from './transfer/controllers/transfer.controller';
import { Transfer, TransferLine } from './transfer/entities/transfer.entity';
import { TransferService } from './transfer/services/transfer.service';

import { ScheduleModule } from '@nestjs/schedule';

import { MaintenanceController } from './maintenance/controllers/maintenance.controller';
import { ExpiryService } from './maintenance/services/expiry.service';
import { SyncController } from './sync/controllers/sync.controller';
import { SyncService } from './sync/services/sync.service';

import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';

import { ReportingController } from './reporting/reporting.controller';
import { ReportingService } from './reporting/reporting.service';

import { AuditInterceptor } from './security/audit.interceptor';
import { AuditLog } from './security/entities/audit-log.entity';
import { RateLimitGuard } from './security/rate-limit.guard';
import { SecurityModule } from './security/security.module';

import { RedisCacheService } from './cache/redis-cache.service';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';

/**
 * A modular monolith, one module per bounded concern, exactly as the technical
 * proposal's section 13 application layer describes. They are wired together
 * here rather than split into services: the domain is one transactional
 * story - a scan changes an item, appends an event and moves stock together -
 * and splitting that across process boundaries would buy nothing but
 * distributed transactions.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRoot(dataSourceOptions),
    TypeOrmModule.forFeature(ENTITIES),
    ScheduleModule.forRoot(),
    StorageModule,


    SecurityModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('redis.url');
        if (url) {
          return { connection: { url } };
        }
        return {
          connection: {
            host: config.getOrThrow<string>('redis.host'),
            port: config.getOrThrow<number>('redis.port'),
          },
        };
      },
    }),
    EmailModule,
    NotificationsModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: {
          // jsonwebtoken types the lifetime as a template literal union, so
          // the configured value is asserted rather than widened to string.
          expiresIn: config.getOrThrow<string>(
            'jwt.expiresIn',
          ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
      }),
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    BarcodeController,
    ScanController,
    UserController,
    OrganizationController,
    FacilityController,
    LocationController,
    ProductController,
    ProductCategoryController,
    PublicCategoryController,
    BrandController,
    BatchController,
    IdentityPoolController,
    ItemController,
    InventoryController,
    TransferController,
    SyncController,
    MaintenanceController,
    SaleController,
    RecallController,
    TraceController,
    VerificationController,
    DashboardController,
    LicenseController,
    LicenseReviewController,
    ProductionEligibilityController,
    ComplianceOverviewController,
    RegulatoryCaseController,
    RegulatoryCaseResponseController,
    RegulatoryInspectionController,
    PublicComplaintController,
    RegulatoryComplaintController,
    RegulatorySignalController,
    RegulatoryCommandController,
    RegulatoryAuthorityController,
    RegulatoryAccountabilityController,
    RegulatoryReferralController,
    RegulatoryOversightController,
    RawMaterialController,
    BomController,
    MachineController,
    ProductionController,
    QualityInspectionController,
    AnalyticsController,
    ReportingController,
    TransporterController,
    VehicleController,
    DriverController,
    RouteController,
    ShipmentController,
    CustomerController,
    QuotationController,
    SalesOrderController,
    InvoiceController,
    SalesReturnController,
    SupplierController,
    PurchaseOrderController,
    AccountController,
    CostCentreController,
    JournalController,
    BudgetController,
    FinanceReportController,
    DepartmentController,
    JobPositionController,
    EmployeeController,
    AttendanceController,
    LeaveController,
    PayrollRunController,
    PayrollReportController,
    SearchController,
  ],
  providers: [
    // Runs ahead of authentication so an unauthenticated flood is turned away
    // before any work is done for it. Inert unless a route declares
    // @RateLimit, so it costs nothing on the rest of the API.
    { provide: APP_GUARD, useClass: RateLimitGuard },

    // Applied to every route. A new endpoint is protected by default and has
    // to opt out explicitly, so authentication cannot be lost by omission.
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    // Applied to every mutating route: each privileged action lands in the
    // append-only audit log before its response goes out.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },

    RedisCacheService,
    SearchService,
    AuthService,
    UserManagementService,
    OrganizationService,
    FacilityService,
    LocationService,
    ProductService,
    CategoryShareService,
    BatchService,
    ItemCodeGenerator,
    IdentityPoolService,
    ItemService,
    LifecycleService,
    BarcodeService,
    ScanService,
    QrCodeService,
    EventRecorder,
    TraceabilityService,
    InventoryService,
    TransferService,
    SyncService,
    ExpiryService,
    SaleService,
    RecallService,
    DashboardService,
    SequenceService,
    LicenseService,
    RegulatoryCaseService,
    RegulatoryCaseDeadlineService,
    RegulatoryInvestigationPackService,
    RegulatoryInspectionService,
    PublicComplaintService,
    RegulatorySignalService,
    RegulatoryCommandService,
    RegulatoryAuthorityService,
    RegulatoryAccountabilityService,
    RegulatoryOversightService,
    LicenseEnforcementService,
    ProductionEligibilityService,
    ComplianceOverviewService,
    RawMaterialService,
    BomService,
    MachineService,
    ProductionService,
    QualityInspectionService,
    AnalyticsService,
    ReportingService,
    TransporterService,
    VehicleService,
    DriverService,
    RouteService,
    ShipmentService,
    CustomerService,
    QuotationService,
    SalesOrderService,
    InvoiceService,
    SalesReturnService,
    SupplierService,
    PurchaseOrderService,
    AccountService,
    CostCentreService,
    JournalService,
    BudgetService,
    FinanceReportService,
    DepartmentService,
    JobPositionService,
    EmployeeService,
    AttendanceService,
    LeaveService,
    PayrollService,
    PayrollReportService,
  ],
})
export class AppModule {}

export { User, Organization, Location, Product, Batch, TraceableItem, CodeSequence, TraceabilityEvent, Transfer, TransferLine, Sale, SaleLine, RawMaterial, BillOfMaterial, BillOfMaterialLine, Machine, ProductionOrder, ProductionOrderMaterial, ProductionEvent, QualityInspection, Transporter, Vehicle, Driver, Route, Shipment, ShipmentEvent, Customer, Quotation, QuotationLine, SalesOrder, SalesOrderLine, SalesOrderReservation, Invoice, Payment, SalesReturn, Supplier, PurchaseOrder, PurchaseOrderLine, Account, CostCentre, JournalEntry, JournalLine, Budget, Department, JobPosition, Employee, EmployeePayItem, Attendance, Leave, PayrollRun, PayrollLine, AuditLog, RegulatoryAuthority };

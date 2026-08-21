import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { User } from '../auth/entities/user.entity';
import { Batch } from '../batch/entities/batch.entity';
import { CodeSequence } from '../item/entities/code-sequence.entity';
import { ComplianceFinding } from '../licensing/entities/compliance-finding.entity';
import {
  License,
  LicenseCategory,
  LicenseDocument,
  LicenseEvent,
} from '../licensing/entities/license.entity';
import { TraceableItem } from '../item/entities/traceable-item.entity';
import { Location } from '../location/entities/location.entity';
import { Facility } from '../organization/entities/facility.entity';
import { Organization } from '../organization/entities/organization.entity';
import { Product } from '../product/entities/product.entity';
import { ProductCategory } from '../product/entities/product-category.entity';
import { Sale, SaleLine } from '../sale/entities/sale.entity';
import { TraceabilityEvent } from '../traceability/entities/traceability-event.entity';
import { Transfer, TransferLine } from '../transfer/entities/transfer.entity';
import {
  BillOfMaterial,
  BillOfMaterialLine,
} from '../manufacturing/entities/bill-of-material.entity';
import { Machine } from '../manufacturing/entities/machine.entity';
import { ProductionEvent } from '../manufacturing/entities/production-event.entity';
import {
  ProductionOrder,
  ProductionOrderMaterial,
} from '../manufacturing/entities/production-order.entity';
import { QualityInspection } from '../manufacturing/entities/quality-inspection.entity';
import { RawMaterial } from '../manufacturing/entities/raw-material.entity';
import { Customer } from '../commerce/entities/customer.entity';
import { Invoice } from '../commerce/entities/invoice.entity';
import { Payment } from '../commerce/entities/payment.entity';
import { Quotation, QuotationLine } from '../commerce/entities/quotation.entity';
import { SalesReturn } from '../commerce/entities/sales-return.entity';
import { SalesOrder, SalesOrderLine } from '../commerce/entities/sales-order.entity';
import { SalesOrderReservation } from '../commerce/entities/sales-order-reservation.entity';
import { Account } from '../finance/entities/account.entity';
import { Budget } from '../finance/entities/budget.entity';
import { CostCentre } from '../finance/entities/cost-centre.entity';
import { JournalEntry, JournalLine } from '../finance/entities/journal.entity';
import { Attendance } from '../payroll/entities/attendance.entity';
import { Department } from '../payroll/entities/department.entity';
import { Employee } from '../payroll/entities/employee.entity';
import { EmployeePayItem } from '../payroll/entities/employee-pay-item.entity';
import { JobPosition } from '../payroll/entities/job-position.entity';
import { Leave } from '../payroll/entities/leave.entity';
import { PayrollLine, PayrollRun } from '../payroll/entities/payroll.entity';
import { Driver } from '../logistics/entities/driver.entity';
import { Route } from '../logistics/entities/route.entity';
import { Shipment, ShipmentEvent } from '../logistics/entities/shipment.entity';
import { Transporter } from '../logistics/entities/transporter.entity';
import { Vehicle } from '../logistics/entities/vehicle.entity';
import { AuditLog } from '../security/entities/audit-log.entity';
import { Notification } from '../notifications/entities/notification.entity';

loadEnv();

/**
 * Every entity, listed explicitly rather than by glob. A glob silently drops
 * entities when the build layout changes; a missing entity here fails loudly
 * at startup instead of at the first query.
 */
export const ENTITIES = [
  User,
  Facility,
  Organization,
  Location,
  Product,
  ProductCategory,
  Batch,
  TraceableItem,
  CodeSequence,
  TraceabilityEvent,
  Transfer,
  TransferLine,
  Sale,
  SaleLine,
  LicenseCategory,
  License,
  LicenseDocument,
  LicenseEvent,
  ComplianceFinding,
  RawMaterial,
  BillOfMaterial,
  BillOfMaterialLine,
  Machine,
  ProductionOrder,
  ProductionOrderMaterial,
  ProductionEvent,
  QualityInspection,
  Transporter,
  Vehicle,
  Driver,
  Route,
  Shipment,
  ShipmentEvent,
  Customer,
  Quotation,
  QuotationLine,
  SalesOrder,
  SalesOrderLine,
  SalesOrderReservation,
  Invoice,
  Payment,
  SalesReturn,
  Account,
  CostCentre,
  JournalEntry,
  JournalLine,
  Budget,
  Department,
  JobPosition,
  Employee,
  EmployeePayItem,
  Attendance,
  Leave,
  PayrollRun,
  PayrollLine,
  AuditLog,
  Notification,
];

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5433', 10),
  database: process.env.DB_NAME ?? 'stock_manager',
  username: process.env.DB_USER ?? 'stock',
  password: process.env.DB_PASSWORD ?? 'stock_dev',
  entities: ENTITIES,
  migrations: [__dirname + '/../migrations/*.{ts,js}'],
  /**
   * Never true. Schema changes go through a reviewed migration, because the
   * platform is deployed to a pilot and then to many organizations - a schema
   * the ORM invents at boot cannot be rolled back or audited.
   */
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
};

export default new DataSource(dataSourceOptions);

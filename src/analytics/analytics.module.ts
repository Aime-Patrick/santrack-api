import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../commerce/entities/invoice.entity';
import { Payment } from '../commerce/entities/payment.entity';
import { JournalLine } from '../finance/entities/journal.entity';

import { TraceableItem } from '../item/entities/traceable-item.entity';
import { License } from '../licensing/entities/license.entity';
import { Location } from '../location/entities/location.entity';
import { ProductionOrder } from '../manufacturing/entities/production-order.entity';
import { QualityInspection } from '../manufacturing/entities/quality-inspection.entity';
import { RawMaterial } from '../manufacturing/entities/raw-material.entity';
import { Organization } from '../organization/entities/organization.entity';
import { Employee } from '../payroll/entities/employee.entity';
import { PayrollLine, PayrollRun } from '../payroll/entities/payroll.entity';
import { Product } from '../product/entities/product.entity';
import { SaleLine } from '../sale/entities/sale.entity';
import { TraceabilityEvent } from '../traceability/entities/traceability-event.entity';
import { Transfer, TransferLine } from '../transfer/entities/transfer.entity';
import { User } from '../auth/entities/user.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      License,
      ProductionOrder,
      QualityInspection,
      RawMaterial,
      SaleLine,
      TraceabilityEvent,
      Transfer,
      TransferLine,
      Invoice,
      Payment,
      PayrollRun,
      PayrollLine,
      JournalLine,
      TraceableItem,
      Location,
      Organization,
      Employee,
      Product,
      User,
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
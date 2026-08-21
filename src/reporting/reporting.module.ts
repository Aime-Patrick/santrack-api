import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Batch } from '../batch/entities/batch.entity';
import { InventoryService } from '../inventory/services/inventory.service';
import { TraceableItem } from '../item/entities/traceable-item.entity';
import { License } from '../licensing/entities/license.entity';
import { Location } from '../location/entities/location.entity';
import { Shipment } from '../logistics/entities/shipment.entity';
import { ProductionOrder } from '../manufacturing/entities/production-order.entity';
import { QualityInspection } from '../manufacturing/entities/quality-inspection.entity';
import { RawMaterial } from '../manufacturing/entities/raw-material.entity';
import { Sale, SaleLine } from '../sale/entities/sale.entity';
import { TraceabilityEvent } from '../traceability/entities/traceability-event.entity';
import { Transfer } from '../transfer/entities/transfer.entity';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      License,
      ProductionOrder,
      QualityInspection,
      RawMaterial,
      SaleLine,
      Sale,
      TraceabilityEvent,
      Shipment,
      Batch,
      Transfer,
      TraceableItem,
      Location,
    ]),
  ],
  controllers: [ReportingController],
  providers: [ReportingService, InventoryService],
})
export class ReportingModule {}
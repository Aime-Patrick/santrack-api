import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IdentityPool } from './entities/identity-pool.entity';
import { LabelPrintJob } from './entities/label-print-job.entity';
import { LabelPrintJobService } from './services/label-print-job.service';
import { LabelPrintJobController } from './controllers/label-print-job.controller';

@Module({
  imports: [TypeOrmModule.forFeature([IdentityPool, LabelPrintJob])],
  controllers: [LabelPrintJobController],
  providers: [LabelPrintJobService],
  exports: [LabelPrintJobService],
})
export class ItemModule {}

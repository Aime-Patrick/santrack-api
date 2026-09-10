import { Body, Controller, Get, Query, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { LabelPrintJobService } from '../services/label-print-job.service';

export class RecordPrintJobDto {
  poolId: number;
  template: string;
  quantity: number;
  renderedCount: number;
}

@ApiTags('Label Print Jobs')
@ApiBearerAuth()
@Controller('api/identity-pools/print-jobs')
export class LabelPrintJobController {
  constructor(private readonly jobs: LabelPrintJobService) {}

  @Post()
  @RequireCapability(Capability.PRINT_LABELS)
  async record(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() body: RecordPrintJobDto,
  ) {
    return this.jobs.record(
      organization,
      actor,
      body.poolId,
      body.template,
      body.quantity,
      body.renderedCount,
    );
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('page') page = '0',
    @Query('size') size = '50',
  ) {
    const result = await this.jobs.listFor(
      organization,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 50, 200),
    );

    return {
      content: result.content.map((job) => ({
        id: job.id,
        poolId: job.poolId,
        poolProductName: job.pool?.product?.name ?? null,
        poolProductSku: job.pool?.product?.sku ?? null,
        template: job.template,
        quantity: job.quantity,
        renderedCount: job.renderedCount,
        printedBy: job.createdBy?.email ?? null,
        createdAt: job.createdAt,
      })),
      total: result.total,
      page: page,
      size,
    };
  }
}

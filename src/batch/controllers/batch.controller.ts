import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateBatchDto } from '../dto/batch.dto';
import { Batch } from '../entities/batch.entity';
import { BatchService } from '../services/batch.service';

@ApiTags('Batches')
@ApiBearerAuth()
@Controller('api/batches')
export class BatchController {
  constructor(private readonly batches: BatchService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateBatchDto,
  ) {
    return describe(await this.batches.create(organization, dto));
  }

  /**
   * Without a productId, the lots this organization manufactured; with one,
   * every lot of that product.
   */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('productId') productId?: string,
  ) {
    const batches = productId
      ? await this.batches.listForProduct(parseInt(productId, 10))
      : await this.batches.list(organization);
    return batches.map(describe);
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(@Param('id', ParseIntPipe) id: number) {
    return describe(await this.batches.get(id));
  }
}

export function describe(batch: Batch) {
  return {
    id: batch.id,
    batchCode: batch.batchCode,
    productId: batch.product.id,
    productName: batch.product.name,
    manufacturerId: batch.manufacturer?.id ?? null,
    manufacturerName: batch.manufacturer?.name ?? null,
    // The plant that made it (DR-02). This is what makes "which facility
    // produced this batch?" answerable directly, which is the first question
    // asked in a recall.
    facilityId: batch.facilityId ?? null,
    facilityName: batch.facility?.name ?? null,
    manufacturedOn: batch.manufacturedOn,
    expiresOn: batch.expiresOn,
    status: batch.status,
    statusReason: batch.statusReason,
    previousStatus: batch.previousStatus ?? null,
    statusChangedAt: batch.statusChangedAt ?? null,
  };
}

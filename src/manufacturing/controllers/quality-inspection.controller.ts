import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { CurrentUser, ActingOrg, RequireCapability } from '../../common/decorators';
import { User } from '../../auth/entities/user.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateInspectionDto } from '../dto/quality-inspection.dto';
import { QualityInspection } from '../entities/quality-inspection.entity';
import { QualityInspectionService } from '../services/quality-inspection.service';

@ApiTags('Manufacturing - Quality Control')
@ApiBearerAuth()
@Controller('api/quality-inspections')
export class QualityInspectionController {
  constructor(private readonly inspections: QualityInspectionService) {}

  @Post()
  @RequireCapability(Capability.PERFORM_QC)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreateInspectionDto,
  ) {
    return describeInspection(
      await this.inspections.create(organization, actor, dto),
    );
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.inspections.list(
      organization,
      parseInt(page, 10),
      parseInt(size, 10),
    );
    return {
      ...result,
      content: result.content.map(describeInspection),
    };
  }
}

export function describeInspection(inspection: QualityInspection) {
  return {
    id: inspection.id,
    productionOrderId: inspection.productionOrder?.id ?? null,
    productionOrderNumber: inspection.productionOrder?.orderNumber ?? null,
    batchId: inspection.batch?.id ?? null,
    batchCode: inspection.batch?.batchCode ?? null,
    inspectorName: inspection.inspector.fullName,
    result: inspection.result,
    notes: inspection.notes,
    testedAt: inspection.testedAt,
  };
}

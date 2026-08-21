import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import {
  CreateCostCentreDto,
  UpdateCostCentreDto,
} from '../dto/account.dto';
import { CostCentre } from '../entities/cost-centre.entity';
import { CostCentreService } from '../services/cost-centre.service';

@ApiTags('Finance - Cost Centres')
@ApiBearerAuth()
@Controller('api/finance/cost-centres')
export class CostCentreController {
  constructor(private readonly costCentres: CostCentreService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_FINANCE)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateCostCentreDto,
  ) {
    return describe(await this.costCentres.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.costCentres.list(organization)).map(describe);
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.costCentres.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_FINANCE)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCostCentreDto,
  ) {
    return describe(await this.costCentres.update(organization, id, dto));
  }
}

function describe(costCentre: CostCentre) {
  return {
    id: costCentre.id,
    code: costCentre.code,
    name: costCentre.name,
    active: costCentre.active,
    createdAt: costCentre.createdAt,
  };
}
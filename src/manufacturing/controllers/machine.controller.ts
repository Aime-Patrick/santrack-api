import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateMachineDto } from '../dto/machine.dto';
import { Machine } from '../entities/machine.entity';
import { MachineService } from '../services/machine.service';

@ApiTags('Manufacturing - Machines')
@ApiBearerAuth()
@Controller('api/machines')
export class MachineController {
  constructor(private readonly machines: MachineService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(@ActingOrg() organization: Organization, @Body() dto: CreateMachineDto) {
    return describeMachine(await this.machines.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.machines.list(organization)).map(describeMachine);
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describeMachine(await this.machines.get(organization, id));
  }
}

export function describeMachine(machine: Machine) {
  return {
    id: machine.id,
    code: machine.code,
    name: machine.name,
    type: machine.type,
    status: machine.status,
    active: machine.active,
    createdAt: machine.createdAt,
  };
}

import { Controller, Get, Param, ParseIntPipe, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateRawMaterialDto } from '../dto/raw-material.dto';
import { RawMaterial } from '../entities/raw-material.entity';
import { RawMaterialService } from '../services/raw-material.service';

@ApiTags('Manufacturing - Raw Materials')
@ApiBearerAuth()
@Controller('api/raw-materials')
export class RawMaterialController {
  constructor(private readonly materials: RawMaterialService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateRawMaterialDto,
  ) {
    return describeMaterial(await this.materials.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.materials.list(organization)).map(describeMaterial);
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describeMaterial(await this.materials.get(organization, id));
  }
}

export function describeMaterial(material: RawMaterial) {
  return {
    id: material.id,
    name: material.name,
    code: material.code,
    category: material.category,
    unitOfMeasure: material.unitOfMeasure,
    unitCost: Number(material.unitCost),
    reorderLevel: Number(material.reorderLevel),
    active: material.active,
    createdAt: material.createdAt,
  };
}

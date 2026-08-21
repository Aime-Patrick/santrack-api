import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateBomDto } from '../dto/bom.dto';
import {
  BillOfMaterial,
  BillOfMaterialLine,
} from '../entities/bill-of-material.entity';
import { BomService } from '../services/bom.service';

@ApiTags('Manufacturing - Bill of Materials')
@ApiBearerAuth()
@Controller('api/boms')
export class BomController {
  constructor(private readonly boms: BomService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(@ActingOrg() organization: Organization, @Body() dto: CreateBomDto) {
    const bom = await this.boms.create(organization, dto);
    return describeBom(bom, await this.boms.linesOf(bom.id));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.boms.list(organization)).map((bom) =>
      describeBom(bom, []),
    );
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const bom = await this.boms.get(organization, id);
    return describeBom(bom, await this.boms.linesOf(bom.id));
  }
}

export function describeLine(line: BillOfMaterialLine) {
  return {
    materialId: line.material.id,
    materialCode: line.material.code,
    materialName: line.material.name,
    quantityPerUnit: Number(line.quantityPerUnit),
    wastagePercent: Number(line.wastagePercent),
  };
}

export function describeBom(bom: BillOfMaterial, lines: BillOfMaterialLine[]) {
  return {
    id: bom.id,
    name: bom.name,
    productId: bom.product.id,
    productName: bom.product.name,
    version: bom.version,
    active: bom.active,
    lines: lines.map(describeLine),
    createdAt: bom.createdAt,
  };
}

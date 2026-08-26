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
import {
  ActingOrg,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';
import { Supplier } from '../entities/supplier.entity';
import { SupplierService } from '../services/supplier.service';

@ApiTags('Purchasing - Suppliers')
@ApiBearerAuth()
@Controller('api/purchasing/suppliers')
export class SupplierController {
  constructor(private readonly suppliers: SupplierService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateSupplierDto,
  ) {
    return describe(await this.suppliers.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const rows = await this.suppliers.list(organization);
    return { total: rows.length, content: rows.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.suppliers.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSupplierDto,
  ) {
    return describe(await this.suppliers.update(organization, id, dto));
  }
}

function describe(supplier: Supplier) {
  return {
    id: supplier.id,
    organizationId: supplier.organization.id,
    linkedOrganizationId: supplier.linkedOrganization?.id ?? null,
    linkedOrganizationName: supplier.linkedOrganization?.name ?? null,
    code: supplier.code,
    name: supplier.name,
    contact: supplier.contact,
    phone: supplier.phone,
    email: supplier.email,
    active: supplier.active,
    createdAt: supplier.createdAt,
  };
}

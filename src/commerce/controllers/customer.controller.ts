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
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/customer.dto';
import { Customer } from '../entities/customer.entity';
import { CustomerService } from '../services/customer.service';

@ApiTags('Commerce - Customers')
@ApiBearerAuth()
@Controller('api/commerce/customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateCustomerDto,
  ) {
    return describe(await this.customers.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const rows = await this.customers.list(organization);
    return { total: rows.length, content: rows.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.customers.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ) {
    return describe(await this.customers.update(organization, id, dto));
  }

  @Get(':id/statement')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async statement(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.customers.statement(organization, id);
    return {
      customerId: result.customer.id,
      customerName: result.customer.name,
      balance: result.balance,
      entries: result.entries,
    };
  }
}

function describe(customer: Customer) {
  return {
    id: customer.id,
    organizationId: customer.organization.id,
    buyerOrganizationId: customer.buyerOrganization?.id ?? null,
    buyerOrganizationName: customer.buyerOrganization?.name ?? null,
    code: customer.code,
    name: customer.name,
    type: customer.type,
    segment: customer.segment,
    contactPerson: customer.contactPerson,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    creditLimit: customer.creditLimit === null ? null : Number(customer.creditLimit),
    active: customer.active,
    createdAt: customer.createdAt,
  };
}
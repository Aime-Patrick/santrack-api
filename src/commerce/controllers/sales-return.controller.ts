import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import {
  ApproveReturnDto,
  RejectReturnDto,
  RequestReturnDto,
} from '../dto/invoice.dto';
import { SalesReturn } from '../entities/sales-return.entity';
import { SalesReturnService } from '../services/sales-return.service';

@ApiTags('Commerce - Returns & Refunds')
@ApiBearerAuth()
@Controller('api/commerce/returns')
export class SalesReturnController {
  constructor(private readonly returns: SalesReturnService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async request(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: RequestReturnDto,
  ) {
    return describe(await this.returns.request(organization, actor, dto));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async approve(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveReturnDto,
  ) {
    return describe(await this.returns.approve(organization, actor, id, dto));
  }

  @Post(':id/refund')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async refund(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.returns.refund(organization, id));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async reject(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectReturnDto,
  ) {
    return describe(await this.returns.reject(organization, id, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.returns.list(
      organization,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 100),
    );
    return { ...result, content: result.content.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.returns.get(organization, id));
  }
}

function describe(salesReturn: SalesReturn) {
  return {
    id: salesReturn.id,
    returnNumber: salesReturn.returnNumber,
    status: salesReturn.status,
    customerId: salesReturn.customer.id,
    customerName: salesReturn.customer.name,
    invoiceId: salesReturn.invoice?.id ?? null,
    invoiceNumber: salesReturn.invoice?.invoiceNumber ?? null,
    reason: salesReturn.reason,
    refundAmount:
      salesReturn.refundAmount === null ? null : Number(salesReturn.refundAmount),
    createdAt: salesReturn.createdAt,
  };
}
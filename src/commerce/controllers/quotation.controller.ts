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
  CreateQuotationDto,
  RejectQuotationDto,
} from '../dto/quotation.dto';
import { Quotation, QuotationLine } from '../entities/quotation.entity';
import { QuotationService } from '../services/quotation.service';

@ApiTags('Commerce - Quotations')
@ApiBearerAuth()
@Controller('api/commerce/quotations')
export class QuotationController {
  constructor(private readonly quotations: QuotationService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreateQuotationDto,
  ) {
    const quotation = await this.quotations.create(organization, actor, dto);
    return describe(quotation, await this.quotations.linesOf(quotation.id));
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async send(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const quotation = await this.quotations.send(organization, id);
    return describe(quotation, await this.quotations.linesOf(quotation.id));
  }

  @Post(':id/accept')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async accept(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const quotation = await this.quotations.accept(organization, id);
    return describe(quotation, await this.quotations.linesOf(quotation.id));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async reject(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectQuotationDto,
  ) {
    const quotation = await this.quotations.reject(organization, id, dto);
    return describe(quotation, await this.quotations.linesOf(quotation.id));
  }

  @Post(':id/expire')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async expire(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const quotation = await this.quotations.expire(organization, id);
    return describe(quotation, await this.quotations.linesOf(quotation.id));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.quotations.list(
      organization,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 100),
    );
    const content = await Promise.all(
      result.content.map(async (quotation) =>
        describe(quotation, await this.quotations.linesOf(quotation.id)),
      ),
    );
    return { ...result, content };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const quotation = await this.quotations.get(organization, id);
    return describe(quotation, await this.quotations.linesOf(quotation.id));
  }
}

function describe(quotation: Quotation, lines: QuotationLine[]) {
  return {
    id: quotation.id,
    quotationNumber: quotation.quotationNumber,
    status: quotation.status,
    customerId: quotation.customer.id,
    customerName: quotation.customer.name,
    validUntilOn: quotation.validUntilOn,
    subtotal: quotation.subtotal === null ? null : Number(quotation.subtotal),
    taxPercent: quotation.taxPercent === null ? null : Number(quotation.taxPercent),
    totalAmount: quotation.totalAmount === null ? null : Number(quotation.totalAmount),
    notes: quotation.notes,
    createdAt: quotation.createdAt,
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.product.id,
      productName: line.product.name,
      description: line.description,
      salesUnit: line.salesUnit,
      requestedQuantity: Number(line.requestedQuantity),
      quantity: Number(line.requestedQuantity),
      unitPrice: Number(line.unitPrice),
      lineTotal: line.lineTotal === null ? null : Number(line.lineTotal),
    })),
  };
}
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { SellDto } from '../dto/sale.dto';
import { Sale, SaleLine } from '../entities/sale.entity';
import { SaleService } from '../services/sale.service';

@ApiTags('Sales')
@ApiBearerAuth()
@Controller('api/sales')
export class SaleController {
  constructor(private readonly sales: SaleService) {}

  @Post()
  @RequireCapability(Capability.SELL)
  async sell(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: SellDto,
  ) {
    const { sale, lines } = await this.sales.sell(organization, actor, dto);
    return describe(sale, lines);
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.sales.list(
      organization,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 100),
    );
    const content = await Promise.all(
      result.content.map(async (sale) =>
        describe(sale, await this.sales.linesOf(sale.id)),
      ),
    );
    return { ...result, content };
  }
}

function describe(sale: Sale, lines: SaleLine[]) {
  return {
    id: sale.id,
    reference: sale.reference,
    type: sale.type,
    sellerOrganizationId: sale.sellerOrganization.id,
    sellerOrganizationName: sale.sellerOrganization.name,
    buyerOrganizationId: sale.buyerOrganization?.id ?? null,
    buyerOrganizationName: sale.buyerOrganization?.name ?? null,
    consumerRef: sale.consumerRef,
    totalAmount: sale.totalAmount,
    transferId: sale.transferId,
    soldAt: sale.soldAt,
    notes: sale.notes,
    lines: lines.map((line) => ({
      id: line.id,
      itemId: line.item.id,
      itemCode: line.item.code,
      itemQrCode: line.item.qrCode,
      quantity: line.quantity,
    })),
  };
}

import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { StockInDto } from '../dto/stock-in.dto';
import { StockInService } from '../services/stock-in.service';

/**
 * Stock In for RETAILER / SHOP.
 *
 * Exposes exactly two endpoints:
 *
 *   GET  /api/stock-in/preview/:qrCode   — read-only preview of arriving container
 *   POST /api/stock-in/confirm           — atomic receipt of the container
 *
 * Both require MOVE_STOCK (every RETAILER/SHOP operator has this) and the
 * service additionally enforces that only RETAILER/SHOP organisations may call
 * them. HANDLE_PACKAGING is used internally by StockInService when it
 * transitions sealed containers — it is never required directly from these
 * endpoints.
 *
 * Existing /api/items/:qrCode/open|pack|remove endpoints remain unchanged and
 * continue to require HANDLE_PACKAGING from roles that use them directly
 * (WAREHOUSE_*, PRODUCTION_*, DISTRIBUTOR roles).
 */
@ApiTags('Stock In')
@ApiBearerAuth()
@Controller('api/stock-in')
export class StockInController {
  constructor(private readonly stockIn: StockInService) {}

  /**
   * Read-only preview of the container the operator just scanned.
   *
   * No state changes; just enough information to show the confirmation screen.
   */
  @Get('preview/:qrCode')
  @RequireCapability(Capability.MOVE_STOCK)
  async preview(
    @ActingOrg() organization: Organization,
    @Param('qrCode') qrCode: string,
  ) {
    return this.stockIn.preview(organization, qrCode);
  }

  /**
   * Confirms receipt of the container and performs the complete inventory
   * transition atomically.
   *
   * Idempotent — repeated calls for the same container return the existing
   * state instead of creating duplicate records.
   */
  @Post('confirm')
  @HttpCode(200)
  @RequireCapability(Capability.MOVE_STOCK)
  async confirm(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: StockInDto,
  ) {
    return this.stockIn.confirm(organization, actor, dto);
  }
}

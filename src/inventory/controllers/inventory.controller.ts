import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { StockAdjustmentDto } from '../dto/inventory.dto';
import { InventoryService } from '../services/inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('api/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** Current stock for the caller's organization, optionally at one location. */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async positions(
    @ActingOrg() organization: Organization,
    @Query('locationId') locationId?: string,
  ) {
    return this.inventory.positions(
      organization,
      locationId ? parseInt(locationId, 10) : undefined,
    );
  }

  /**
   * Records the result of a physical stock count.  Each discrepancy between
   * the system count and the physical count is appended as a CORRECTION event
   * on the item's timeline.
   */
  @Post('adjust')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async adjust(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: StockAdjustmentDto,
  ) {
    return this.inventory.adjust(organization, actor, dto);
  }
}

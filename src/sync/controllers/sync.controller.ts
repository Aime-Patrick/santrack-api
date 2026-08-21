import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { SyncRequestDto } from '../dto/sync.dto';
import { SyncService } from '../services/sync.service';

/**
 * The upload half of offline-first operation (Core Architecture §11).
 *
 * A device that worked without a connection posts its queue here in the order
 * it recorded it, and gets a verdict per operation so it knows exactly which
 * ones to mark synchronised. Replays are safe: an operation already applied
 * comes back DUPLICATE rather than being recorded twice.
 *
 * 200 rather than 201: the response is a report on a batch, and a batch can
 * contain successes and failures at once. There is no single created thing to
 * point at.
 */
@ApiTags('Sync')
@ApiBearerAuth()
@Controller('api/sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Requires MOVE_STOCK: the queue carries field operations, and this is the
   * capability every field role holds. Each individual operation is still
   * subject to the rules of the service that owns it, so uploading cannot do
   * anything the online routes would refuse.
   */
  @Post()
  @HttpCode(200)
  @RequireCapability(Capability.MOVE_STOCK)
  async replay(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: SyncRequestDto,
  ) {
    return this.sync.replay(organization, actor, dto);
  }
}

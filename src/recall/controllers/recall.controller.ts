import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { LiftRecallDto, RecallDto } from '../dto/recall.dto';
import { RecallService } from '../services/recall.service';

@ApiTags('Recalls')
@ApiBearerAuth()
@Controller('api/recalls')
export class RecallController {
  constructor(private readonly recalls: RecallService) {}

  /** List all recalled batches across the platform. */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list() {
    return this.recalls.list();
  }

  /** One recalled lot with full impact — used by the recall detail page. */
  @Get('batches/:batchId')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(@Param('batchId', ParseIntPipe) batchId: number) {
    return this.recalls.get(batchId);
  }

  /** Pull a production lot, wherever its units currently sit. */
  @Post()
  @RequireCapability(Capability.MANAGE_RECALL)
  async recall(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: RecallDto,
  ) {
    return this.recalls.recallBatch(organization, actor, dto);
  }

  @Post('batches/:batchId/lift')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_RECALL)
  async lift(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('batchId', ParseIntPipe) batchId: number,
    @Body() dto?: LiftRecallDto,
  ) {
    return this.recalls.liftRecall(organization, actor, batchId, dto?.reason);
  }

  /** Where the batch is now, so a recall can be worked rather than announced. */
  @Get('batches/:batchId/impact')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async impact(@Param('batchId', ParseIntPipe) batchId: number) {
    return this.recalls.impact(batchId);
  }
}

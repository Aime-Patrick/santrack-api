import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { RequireCapability } from '../../common/decorators';
import { ExpiryService } from '../services/expiry.service';

/**
 * Manual triggers for the scheduled maintenance jobs.
 *
 * The sweep runs nightly on its own. This exists because a job that can only
 * be observed by waiting until 2am is a job nobody can test, demonstrate or
 * recover after an outage. Restricted to the platform operator, since it acts
 * across every organization's stock.
 */
@ApiTags('Maintenance')
@ApiBearerAuth()
@Controller('api/maintenance')
export class MaintenanceController {
  constructor(private readonly expiry: ExpiryService) {}

  @Post('expiry-sweep')
  @HttpCode(200)
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async sweep() {
    return this.expiry.sweep();
  }
}

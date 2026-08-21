import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../auth/capabilities';
import { ActingOrg, RequireCapability } from '../common/decorators';
import { Organization } from '../organization/entities/organization.entity';
import { ScanService } from './scan.service';

/**
 * One question, asked by every scanning screen: what did I just scan?
 *
 * Having a single answer to that is what lets a scan box be scanned into
 * rather than chosen from. The screen reacts to the kind that comes back
 * instead of assuming one, which is why the same box can open an item's
 * history, recognise a supplier's barcode, or pull up a dispatch note.
 */
@ApiTags('Scan')
@ApiBearerAuth()
@Controller('api/scan')
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  /**
   * Identifies a scanned code.
   *
   * The code is a path segment, so a GS1 element string with its brackets and
   * slashes must be URI-encoded by the caller.
   */
  @Get(':code')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async resolve(
    @ActingOrg() organization: Organization,
    @Param('code') code: string,
  ) {
    return this.scan.resolve(decodeURIComponent(code), organization);
  }
}

import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../auth/capabilities';
import { ActingOrg, RequireCapability } from '../common/decorators';
import { Organization } from '../organization/entities/organization.entity';
import { AuditService } from './audit.service';

/**
 * Audit log access (proposal section 15). Reading the log is a read-only
 * operation, so any role that can read operations - including the auditor
 * whose job this exists for - can read it. Writing never happens here.
 */
@ApiTags('Security')
@ApiBearerAuth()
@Controller('api/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async recent(
    @ActingOrg() organization: Organization,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 100,
  ) {
    const entries = await this.audit.recent(organization.id, limit);
    return { entries: entries.map((entry) => this.flatten(entry)) };
  }

  private flatten(entry: Awaited<ReturnType<AuditService['recent']>>[number]) {
    return {
      id: entry.id,
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      detail: entry.detail,
      actor: entry.actor?.fullName ?? entry.actor?.email ?? 'anonymous',
      performedAt: entry.performedAt,
      remoteAddress: entry.remoteAddress,
    };
  }
}
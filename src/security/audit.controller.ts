import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../auth/capabilities';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../auth/user-role.enum';
import {
  CurrentUser,
  OptionalActingOrg,
  RequireCapability,
} from '../common/decorators';
import {
  NotFoundEntityException,
  OrganizationRequiredException,
} from '../common/errors';
import { Organization } from '../organization/entities/organization.entity';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';

/**
 * Audit log access (proposal section 15).
 *
 * Business staff see their own organization's footprint. The platform
 * operator sees every organization — the digital footprint of the whole
 * platform — and may narrow by organizationId. Detail returns every field
 * stored on the entry plus the related actor and organization records.
 */
@ApiTags('Security')
@ApiBearerAuth()
@Controller('api/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async recent(
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 100,
    @Query('organizationId', new ParseIntPipe({ optional: true }))
    organizationId?: number,
  ) {
    const platformWide = actor.role === UserRole.SYSTEM_ADMIN;
    if (!platformWide && !organization) {
      throw new OrganizationRequiredException();
    }

    // Only the platform operator may read across organizations or pick one.
    const scopeId = platformWide ? organizationId : organization!.id;

    const entries = await this.audit.recent(scopeId, limit);
    return {
      scope: platformWide && !organizationId ? 'platform' : 'organization',
      entries: entries.map((entry) => this.summarize(entry)),
    };
  }

  /**
   * One write in full — actor identity, organization standing fields, and
   * every column on the audit row. Used by the detail screen so the list
   * does not have to carry nested payloads.
   */
  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async one(
    @Param('id', ParseIntPipe) id: number,
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
  ) {
    const entry = await this.audit.findById(id);
    if (!entry) {
      throw new NotFoundEntityException('AuditLog', id);
    }

    const platformWide = actor.role === UserRole.SYSTEM_ADMIN;
    if (!platformWide) {
      if (!organization) {
        throw new OrganizationRequiredException();
      }
      if (entry.organization?.id !== organization.id) {
        // Same shape as missing — do not leak that the id exists elsewhere.
        throw new NotFoundEntityException('AuditLog', id);
      }
    }

    return this.detail(entry);
  }

  private summarize(entry: AuditLog) {
    return {
      id: entry.id,
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      detail: entry.detail,
      actor: entry.actor?.fullName ?? entry.actor?.email ?? 'anonymous',
      actorId: entry.actor?.id ?? null,
      organizationId: entry.organization?.id ?? null,
      organizationName: entry.organization?.name ?? null,
      performedAt: entry.performedAt,
      remoteAddress: entry.remoteAddress,
    };
  }

  private detail(entry: AuditLog) {
    const actor = entry.actor;
    const org = entry.organization;
    return {
      id: entry.id,
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      detail: entry.detail,
      performedAt: entry.performedAt,
      remoteAddress: entry.remoteAddress,
      actor: actor
        ? {
            id: actor.id,
            email: actor.email,
            fullName: actor.fullName,
            role: actor.role,
            mustChangePassword: actor.mustChangePassword,
            createdAt: actor.createdAt,
            organizationId: actor.organization?.id ?? null,
            organizationName: actor.organization?.name ?? null,
            organizationType: actor.organization?.type ?? null,
          }
        : null,
      organization: org
        ? {
            id: org.id,
            name: org.name,
            type: org.type,
            tin: org.tin,
            registrationNumber: org.registrationNumber,
            createdAt: org.createdAt,
          }
        : null,
      // List-compatible display fields for shared UI bits.
      actorDisplay: actor?.fullName ?? actor?.email ?? 'anonymous',
      organizationName: org?.name ?? null,
    };
  }
}

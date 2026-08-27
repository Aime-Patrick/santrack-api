import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../auth/capabilities';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../auth/user-role.enum';
import {
  CurrentUser,
  OptionalActingOrg,
  RequireCapability,
} from '../common/decorators';
import { OrganizationRequiredException } from '../common/errors';
import { Organization } from '../organization/entities/organization.entity';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('api/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * Global search. Business staff search within their organization.
   * The platform operator searches industries and users across the platform.
   */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  searchGlobal(
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
    @Query('q') q = '',
  ) {
    if (actor.role === UserRole.SYSTEM_ADMIN && !organization) {
      return this.search.searchPlatform(q ?? '');
    }
    if (!organization) {
      throw new OrganizationRequiredException();
    }
    return this.search.search(organization.id, q ?? '');
  }
}

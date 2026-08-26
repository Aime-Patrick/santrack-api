import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../auth/capabilities';
import { ActingOrg, RequireCapability } from '../common/decorators';
import { Organization } from '../organization/entities/organization.entity';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('api/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * Org-scoped global search. Results are cached in Redis (~90s) so repeated
   * keystrokes for the same query do not re-hit the database.
   */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  searchGlobal(
    @ActingOrg() organization: Organization,
    @Query('q') q = '',
  ) {
    return this.search.search(organization.id, q ?? '');
  }
}

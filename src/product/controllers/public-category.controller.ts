import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { RateLimit } from '../../security/rate-limit.guard';
import { CategoryShareService } from '../services/category-share.service';

/**
 * Public category share pages. Opaque UUID only — same posture as
 * `GET /api/verify/:token`. Never accepts category id or code.
 */
@ApiTags('Public Categories')
@Controller('api/public/categories')
export class PublicCategoryController {
  constructor(private readonly shares: CategoryShareService) {}

  @Get(':token')
  @Public()
  @RateLimit('verify', 300, 60 * 1000)
  async resolve(@Param('token') token: string) {
    return this.shares.resolvePublic(token);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators';

/** Liveness probe for Render / load balancers. Unauthenticated, no DB. */
@ApiTags('Health')
@Controller('api/health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness check (no auth)' })
  check(): { status: string } {
    return { status: 'ok' };
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

/** Liveness probe for Render / load balancers. Unauthenticated, no DB. */
@ApiExcludeController()
@Controller('api/health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}

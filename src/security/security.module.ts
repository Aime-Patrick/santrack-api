import { MiddlewareConsumer, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';
import { SecurityHeadersMiddleware } from './security-headers.middleware';

/**
 * Security hardening (technical proposal section 15): the audit log of every
 * privileged action and hardening response headers on every route. Rate
 * limiting is provided by a pure helper consumed by the public verification
 * endpoint, so it applies where there is no authenticated identity to trust.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class SecurityModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
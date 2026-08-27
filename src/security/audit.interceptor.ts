import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { clientAddress } from './client-address';

/**
 * Writes every mutating request to the audit log (technical proposal section
 * 15). The path, method, actor, organization and outcome are recorded after
 * the handler completes - including failures, so an attempted action is on
 * the record too. GET/HEAD/OPTIONS requests are read-only and skipped.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = (request.method as string).toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }
    const user = request.user;
    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          const response = context.switchToHttp().getResponse();
          const statusCode = response.statusCode ?? 200;
          const path = (request.originalUrl ?? request.url ?? '').slice(0, 512);
          const detail = this.describe(body);
          this.audit.record({
            actor: user,
            organization: user?.organization,
            method,
            path,
            statusCode,
            detail,
            remoteAddress: clientAddress(request),
          });
        },
        error: (error: { status?: number; message?: string }) => {
          const response = context.switchToHttp().getResponse();
          const statusCode = error?.status ?? response?.statusCode ?? 500;
          const path = (request.originalUrl ?? request.url ?? '').slice(0, 512);
          this.audit.record({
            actor: user,
            organization: user?.organization,
            method,
            path,
            statusCode,
            detail: error?.message ? String(error.message).slice(0, 1000) : null,
            remoteAddress: clientAddress(request),
          });
        },
      }),
    );
  }

  /** A safe, short summary of what a mutation produced. No request bodies. */
  private describe(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const record = body as Record<string, unknown>;
    for (const key of ['reference', 'number', 'entryNumber', 'runNumber', 'id']) {
      const value = record[key];
      if (value !== undefined && value !== null) {
        return `created ${String(value)}`.slice(0, 1000);
      }
    }
    if (Array.isArray(record)) {
      return `returned ${record.length} records`;
    }
    return null;
  }
}
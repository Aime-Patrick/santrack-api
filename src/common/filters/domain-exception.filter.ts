import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * One response shape for every failure, so a client - especially an offline
 * client reconciling a queue - can branch on the body without guessing.
 *
 * Domain exceptions already carry their own payload and pass through intact.
 * Anything unexpected is logged in full and reported as a bare 500: internal
 * detail in an error body is how database structure leaks to the internet.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const body = payload as Record<string, unknown>;
        response.status(status).json({
          status,
          // Validation errors arrive as an array of strings; join them so the
          // caller reads one sentence instead of parsing a shape.
          message: Array.isArray(body.message)
            ? (body.message as string[]).join('; ')
            : (body.message ?? exception.message),
          timestamp: body.timestamp ?? new Date().toISOString(),
          ...omit(body, ['status', 'message', 'timestamp', 'error', 'statusCode']),
        });
        return;
      }

      response.status(status).json({
        status,
        message: String(payload),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: 500,
      message: 'Something went wrong handling this request',
      timestamp: new Date().toISOString(),
    });
  }
}

function omit(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}

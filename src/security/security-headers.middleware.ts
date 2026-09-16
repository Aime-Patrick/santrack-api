import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Security headers on every response (technical proposal section 15: security
 * hardening). A dependency-free stand-in for a helmet middleware - each header
 * that has a sensible hardening value is set explicitly.
 *
 * CSP is intentionally strict for the JSON API. When Swagger UI is enabled
 * (`ENABLE_SWAGGER=true` or non-production), a looser policy allows the docs
 * assets; otherwise `default-src 'none'` keeps browsers from executing
 * unexpected content if an endpoint ever returned HTML by mistake.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-XSS-Protection', '1; mode=block');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    response.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );

    const swaggerOn =
      process.env.ENABLE_SWAGGER === 'true' ||
      process.env.NODE_ENV !== 'production';
    response.setHeader(
      'Content-Security-Policy',
      swaggerOn
        ? "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'"
        : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );

    next();
  }
}

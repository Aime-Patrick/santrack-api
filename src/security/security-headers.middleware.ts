import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Security headers on every response (technical proposal section 15: security
 * hardening). A dependency-free stand-in for a helmet middleware - each header
 * that has a sensible hardening value is set explicitly, and the ones that
 * need application-specific values (a CSP nonce for inline scripts) are left
 * off rather than guessed.
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
    next();
  }
}
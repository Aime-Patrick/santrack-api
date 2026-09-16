import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { Response } from 'express';

/** HttpOnly cookie that carries the JWT for browser clients. */
export const SESSION_COOKIE = 'santrack_session';

/** JWT claim used for the short-lived MFA challenge step. */
export const MFA_TOKEN_PURPOSE = 'mfa_challenge';

export function sessionCookieOptions(maxAgeSeconds: number) {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure,
    // Cross-site SPA (e.g. Vercel → Render) needs None+Secure in production.
    sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: maxAgeSeconds * 1000,
    path: '/',
  };
}

export function setSessionCookie(
  res: Response,
  token: string,
  maxAgeSeconds: number,
): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(maxAgeSeconds));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
}

/** Seconds until JWT / cookie expiry. Defaults match configuration (8h). */
export function sessionTtlSeconds(expiresIn: string | undefined): number {
  const raw = (expiresIn ?? '8h').trim().toLowerCase();
  const match = /^(\d+)([smhd])?$/.exec(raw);
  if (!match) return 8 * 60 * 60;
  const n = parseInt(match[1]!, 10);
  const unit = match[2] ?? 's';
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 60 * 60;
  if (unit === 'd') return n * 24 * 60 * 60;
  return n;
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Encrypt MFA secret at rest (AES-256-GCM). */
export function encryptSecret(plain: string, jwtSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(jwtSecret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptSecret(payload: string, jwtSecret: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid MFA secret payload');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(jwtSecret),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Best-effort client address for audit / rate limits.
 *
 * Prefer X-Forwarded-For when a trusted proxy sits in front (set
 * TRUST_PROXY_HOPS so Express fills request.ip correctly too). Fall back to
 * the socket address. Normalize loopback forms so the log does not show "::".
 */
export function clientAddress(request: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string | null {
  const forwarded = request.headers?.['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof forwardedValue === 'string' && forwardedValue.trim()) {
    return normalizeAddress(forwardedValue.split(',')[0].trim());
  }

  const raw = request.ip ?? request.socket?.remoteAddress ?? null;
  return raw ? normalizeAddress(raw) : null;
}

function normalizeAddress(raw: string): string {
  if (raw === '::' || raw === '::1') return '127.0.0.1';
  if (raw.startsWith(':ffff:')) return raw.slice(7);
  return raw;
}

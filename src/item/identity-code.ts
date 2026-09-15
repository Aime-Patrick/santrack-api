/**
 * Peel phone-camera / paste noise off an identity code before lookup.
 * Accepts bare UUIDs, ST- serials, and full /verify/{uuid} links so one
 * printed QR works for public verify and every authenticated scan stage.
 */
const UUID_TOKEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeIdentityCode(raw: string): string {
  let token = (raw ?? '').trim().replace(/^["']|["']$/g, '');
  try {
    token = decodeURIComponent(token);
  } catch {
    // keep raw
  }
  token = token.trim();

  if (token.includes('/verify/')) {
    token =
      token.split('/verify/').pop()?.split('?')[0].split('#')[0].trim() ?? token;
  }

  if (UUID_TOKEN.test(token)) {
    return token.toLowerCase();
  }
  return token;
}

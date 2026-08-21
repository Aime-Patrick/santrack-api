/**
 * Reading the barcodes that arrive on other people's goods.
 *
 * The platform prints eighteen symbologies but, until now, only ever looked up
 * its own QR identities. That wastes the codes already on the carton: a
 * supplier's delivery has an EAN-13 on every pack and a GS1-128 on the outer
 * case, and a scanner pointed at either produces digits this platform can
 * match against a product it already knows about — no typing, no picking from
 * a dropdown of four hundred products.
 *
 * The obstacle is that the same product yields different digits depending on
 * which barcode was scanned. A retail pack reads as a 13-digit EAN, its North
 * American equivalent as a 12-digit UPC, the shipping case as a 14-digit
 * ITF-14, and a GS1-128 wraps it in an application identifier. They are all
 * the same GTIN with different padding, so everything is normalised to
 * fourteen digits before comparison.
 */

/** A GTIN in its canonical 14-digit form, or null if this is not one. */
export function normaliseGtin(raw: string): string | null {
  const digits = extractDigits(raw);
  if (digits === null) {
    return null;
  }

  // GTIN-8, -12, -13 and -14 are the only defined lengths. Anything else is
  // some other number that happens to be numeric - a batch code, a serial -
  // and treating it as a GTIN would match the wrong product.
  if (![8, 12, 13, 14].includes(digits.length)) {
    return null;
  }

  return digits.padStart(14, '0');
}

/**
 * Pulls the GTIN digits out of whatever the scanner produced.
 *
 * Handles the bracketed GS1 element strings the platform prints, the
 * FNC1-prefixed form a hardware scanner emits for the same symbol, and plain
 * digits from a retail barcode.
 */
function extractDigits(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  // Bracketed element string: (01)09501101020917(10)LOT-A
  const bracketed = value.match(/\((01)\)(\d{14})/);
  if (bracketed) {
    return bracketed[2];
  }

  // Unbracketed, as a hardware scanner emits it: 0109501101020917...
  // AI 01 is fixed-length, so the fourteen digits after it are the GTIN and
  // anything beyond is a further element.
  const unbracketed = value.match(/^01(\d{14})/);
  if (unbracketed && value.length >= 16) {
    return unbracketed[1];
  }

  // A plain retail barcode. Spaces and hyphens are how people write ISBNs.
  const plain = value.replace(/[\s-]/g, '');
  return /^\d+$/.test(plain) ? plain : null;
}

/** Whether two GTINs identify the same trade item, whatever form each is in. */
export function sameGtin(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const left = normaliseGtin(a);
  const right = normaliseGtin(b);
  return left !== null && left === right;
}

/**
 * The batch or lot number a GS1 code carries in application identifier 10, if
 * it has one.
 *
 * A supplier's case label usually states the lot alongside the product, which
 * is exactly what a goods-receipt scan needs and exactly what an operator
 * would otherwise be copying by hand off the side of a box.
 */
export function batchFromGs1(raw: string): string | null {
  const bracketed = raw.match(/\((10)\)([^(]+)/);
  if (bracketed) {
    return bracketed[2].trim() || null;
  }
  return null;
}

/**
 * The expiry date in application identifier 17, as yyyy-MM-dd.
 *
 * GS1 writes dates as YYMMDD. A day of "00" means "end of that month", which
 * is a real convention on pharmaceutical packs, so it resolves to the last day
 * rather than being rejected as an invalid date.
 */
export function expiryFromGs1(raw: string): string | null {
  const match = raw.match(/\((17)\)(\d{6})/);
  if (!match) {
    return null;
  }

  const value = match[2];
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));

  if (month < 1 || month > 12) {
    return null;
  }

  // Day zero means the end of the month, per the GS1 general specifications.
  const resolved = day === 0 ? new Date(year, month, 0).getDate() : day;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(resolved)}`;
}

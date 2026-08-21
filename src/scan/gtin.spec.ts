import { batchFromGs1, expiryFromGs1, normaliseGtin, sameGtin } from './gtin';

describe('reading a GTIN off whatever was scanned', () => {
  it('pads every GTIN length to the canonical fourteen digits', () => {
    // The same trade item reads differently depending on which barcode the
    // scanner happened to be pointed at, and all of them have to match.
    expect(normaliseGtin('5901234123457')).toBe('05901234123457'); // EAN-13
    expect(normaliseGtin('012345678905')).toBe('00012345678905'); // UPC-A
    expect(normaliseGtin('96385074')).toBe('0000000096385074'.slice(-14)); // EAN-8
    expect(normaliseGtin('00123456789012')).toBe('00123456789012'); // ITF-14
  });

  it('treats a retail pack and its shipping case as the same product', () => {
    // This is the whole point: the case code is the pack code, zero-padded.
    expect(sameGtin('5901234123457', '05901234123457')).toBe(true);
    expect(sameGtin('012345678905', '00012345678905')).toBe(true);
  });

  it('does not treat two different products as the same', () => {
    expect(sameGtin('5901234123457', '5901234123458')).toBe(false);
  });

  it('reads the GTIN out of a bracketed GS1 element string', () => {
    expect(normaliseGtin('(01)09501101020917(10)LOT-A(17)261231')).toBe(
      '09501101020917',
    );
  });

  it('reads the GTIN out of the unbracketed form a hardware scanner emits', () => {
    // A scanner reports the same symbol without brackets; AI 01 is fixed
    // length, so the fourteen digits after it are the GTIN.
    expect(normaliseGtin('0109501101020917' + '10LOTA')).toBe('09501101020917');
  });

  it('ignores the spacing a human writes an ISBN with', () => {
    expect(normaliseGtin('978-0-306-40615-7')).toBe('09780306406157');
  });

  it('refuses a number that is not a GTIN length', () => {
    // A batch code or a serial number is numeric too, and matching one against
    // the catalogue would find the wrong product.
    expect(normaliseGtin('12345')).toBeNull();
    expect(normaliseGtin('123456789012345678')).toBeNull();
  });

  it('refuses something that is not a number at all', () => {
    expect(normaliseGtin('ST-QR-000001-4F2A9C')).toBeNull();
    expect(normaliseGtin('')).toBeNull();
  });
});

describe('the rest of what a GS1 code carries', () => {
  it('reads the batch out of application identifier 10', () => {
    // A supplier's case states the lot next to the product code, which is
    // exactly what a goods receipt would otherwise be copied by hand.
    expect(batchFromGs1('(01)09501101020917(10)LOT-A')).toBe('LOT-A');
    expect(batchFromGs1('(10)BT-2026-0001(01)09501101020917')).toBe('BT-2026-0001');
  });

  it('has no batch when the code does not carry one', () => {
    expect(batchFromGs1('5901234123457')).toBeNull();
    expect(batchFromGs1('(01)09501101020917')).toBeNull();
  });

  it('reads the expiry out of application identifier 17', () => {
    expect(expiryFromGs1('(01)09501101020917(17)261231')).toBe('2026-12-31');
  });

  it('reads a day of zero as the end of that month', () => {
    // A real convention on pharmaceutical packs: "expires end of February".
    expect(expiryFromGs1('(17)260200')).toBe('2026-02-28');
    expect(expiryFromGs1('(17)280200')).toBe('2028-02-29');
    expect(expiryFromGs1('(17)260400')).toBe('2026-04-30');
  });

  it('refuses an impossible month rather than inventing a date', () => {
    expect(expiryFromGs1('(17)261331')).toBeNull();
  });

  it('has no expiry when the code does not carry one', () => {
    expect(expiryFromGs1('5901234123457')).toBeNull();
  });
});

import { TraceabilityRuleException } from '../common/errors';
import { BarcodeService } from './barcode.service';
import {
  DEFAULT_SYMBOLOGY,
  SYMBOLOGIES,
  Symbology,
  SymbologyUse,
  catalogue,
} from './symbology';

const barcodes = new BarcodeService();

/** The validation half of a spec, without drawing anything. */
function check(symbology: Symbology, value: string) {
  return barcodes.check(symbology, value);
}

describe('the symbology catalogue', () => {
  it('describes every symbology it offers', () => {
    // The picker renders these words. A symbology with no purpose written down
    // is one an operator has to guess at, and guessing produces a label that
    // does not scan at its destination.
    for (const spec of catalogue()) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.purpose.length).toBeGreaterThan(0);
      expect(spec.accepts.length).toBeGreaterThan(0);
      expect(spec.example.length).toBeGreaterThan(0);
    }
  });

  it('gives every use a default that is actually in the catalogue', () => {
    for (const use of Object.values(SymbologyUse)) {
      const preferred = DEFAULT_SYMBOLOGY[use];
      expect(SYMBOLOGIES[preferred]).toBeDefined();
    }
  });

  it('accepts its own examples', () => {
    // The example is what the preview renders before an operator types
    // anything, so an example its own validator rejects is a broken picker.
    for (const spec of catalogue()) {
      const result = check(spec.symbology, spec.example);
      expect(result).not.toHaveProperty('problem');
    }
  });

  it('rejects an unknown code type by name rather than defaulting', () => {
    // Silently falling back to QR would print the wrong label and say nothing.
    expect(() => barcodes.parseSymbology('EAN_99', Symbology.QR)).toThrow(
      TraceabilityRuleException,
    );
    expect(barcodes.parseSymbology(undefined, Symbology.CODE_128)).toBe(
      Symbology.CODE_128,
    );
    expect(barcodes.parseSymbology('ean_13', Symbology.QR)).toBe(Symbology.EAN_13);
  });
});

describe('check digits', () => {
  it('completes a GTIN that is one digit short', () => {
    // A catalogue usually holds the twelve significant digits.
    expect(check(Symbology.EAN_13, '590123412345')).toEqual({
      value: '5901234123457',
    });
    expect(check(Symbology.UPC_A, '01234567890')).toEqual({
      value: '012345678905',
    });
    expect(check(Symbology.EAN_8, '9638507')).toEqual({ value: '96385074' });
  });

  it('refuses a GTIN whose check digit contradicts its digits', () => {
    // This is the failure that matters: such a code scans, and it scans as
    // something else. Printing it is worse than printing nothing.
    const result = check(Symbology.EAN_13, '5901234123458');
    expect(result).toHaveProperty('problem');
    expect((result as { problem: string }).problem).toContain('should end in 7');
  });

  it('refuses a GTIN of the wrong length', () => {
    expect(check(Symbology.EAN_13, '12345')).toHaveProperty('problem');
  });

  it('ignores the spacing a human types', () => {
    expect(check(Symbology.EAN_13, '590-1234 123457')).toEqual({
      value: '5901234123457',
    });
  });
});

describe('ISBN', () => {
  it('passes a hyphenated ISBN through so the ISBN line prints', () => {
    expect(check(Symbology.ISBN, '978-0-306-40615-7')).toEqual({
      value: '978-0-306-40615-7',
    });
  });

  it('accepts a price add-on', () => {
    expect(check(Symbology.ISBN, '978-0-306-40615-7 51999')).toEqual({
      value: '978-0-306-40615-7 51999',
    });
  });

  it('refuses an add-on that is not 2 or 5 digits', () => {
    expect(check(Symbology.ISBN, '978-0-306-40615-7 123')).toHaveProperty(
      'problem',
    );
  });

  it('refuses a 13-digit code that is not a book', () => {
    // 978 and 979 are the only Bookland prefixes; anything else is an ordinary
    // retail GTIN and should be printed as one.
    const result = check(Symbology.ISBN, '5901234123457');
    expect(result).toHaveProperty('problem');
    expect((result as { problem: string }).problem).toContain('978 or 979');
  });

  it('catches a mistyped ISBN check digit', () => {
    expect(check(Symbology.ISBN, '978-0-306-40615-8')).toHaveProperty('problem');
  });
});

describe('SSCC-18', () => {
  it('normalises bare digits to the application identifier form', () => {
    // Operators read eighteen digits off a pallet label; the encoder wants
    // them tagged as GS1 AI 00.
    expect(check(Symbology.SSCC_18, '006141411234567890')).toEqual({
      value: '(00)006141411234567890',
    });
  });

  it('completes a 17-digit SSCC', () => {
    expect(check(Symbology.SSCC_18, '00614141123456789')).toEqual({
      value: '(00)006141411234567890',
    });
  });

  it('accepts the bracketed form unchanged', () => {
    expect(check(Symbology.SSCC_18, '(00)006141411234567890')).toEqual({
      value: '(00)006141411234567890',
    });
  });
});

describe('character sets', () => {
  it('upper-cases for Code 39 rather than refusing', () => {
    // Code 39 has no lower case; the symbol is the same either way, so there
    // is nothing to gain by making the operator retype it.
    expect(check(Symbology.CODE_39, 'st-lpt-000001')).toEqual({
      value: 'ST-LPT-000001',
    });
  });

  it('names the offending character when Code 39 cannot carry it', () => {
    const result = check(Symbology.CODE_39, 'ST_LPT');
    expect(result).toHaveProperty('problem');
    expect((result as { problem: string }).problem).toContain('_');
  });

  it('requires Codabar start and stop characters', () => {
    expect(check(Symbology.CODABAR, '123456')).toHaveProperty('problem');
    expect(check(Symbology.CODABAR, 'A123456B')).toEqual({ value: 'A123456B' });
  });

  it('requires GS1 codes to carry application identifiers', () => {
    expect(check(Symbology.GS1_128, 'JUST-SOME-TEXT')).toHaveProperty('problem');
    expect(check(Symbology.GS1_DATA_MATRIX, '(01)09501101020917')).toEqual({
      value: '(01)09501101020917',
    });
  });
});

describe('rendering', () => {
  // These go through BWIPP for real. A catalogue entry that validates but will
  // not draw is worse than one that refuses up front: the operator finds out
  // at the printer.
  it.each(catalogue().map((spec) => [spec.symbology, spec.example]))(
    'renders %s',
    async (symbology, example) => {
      const label = await barcodes.render({
        symbology: symbology as Symbology,
        value: example as string,
      });
      expect(label.contentType).toBe('image/png');
      expect((label.body as Buffer).length).toBeGreaterThan(100);
    },
  );

  it('renders SVG when asked', async () => {
    const label = await barcodes.render({
      symbology: Symbology.QR,
      value: 'ST-QR-000001-4F2A9C',
      format: 'svg',
    });
    expect(label.contentType).toBe('image/svg+xml');
    expect(label.body).toContain('<svg');
  });

  it('reports a bad value as a rule violation, not a stack trace', async () => {
    await expect(
      barcodes.render({ symbology: Symbology.EAN_13, value: 'not-a-gtin' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses a payload too large to be an identifier', async () => {
    // A QR that carries the data instead of pointing at it publishes that data
    // to anyone with a phone camera.
    await expect(
      barcodes.render({ symbology: Symbology.QR, value: 'x'.repeat(5000) }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('clamps scale rather than trusting the caller', async () => {
    // Scale arrives from a query string, and BWIPP allocates whatever it is
    // given, so an unbounded value is a way to ask for a gigabyte PNG.
    const huge = await barcodes.render({
      symbology: Symbology.QR,
      value: 'ST-QR-000001',
      scale: 10_000,
    });
    expect((huge.body as Buffer).length).toBeLessThan(2_000_000);
  });

  it('prints the human-readable line where the standard expects one', async () => {
    // A retail cashier keys the number when the scanner will not read it, so
    // an EAN with no printed digits is a dead end at the till. A QR has no
    // such convention and printing one under it is just noise.
    const withText = await barcodes.render({
      symbology: Symbology.EAN_13,
      value: '5901234123457',
    });
    const withoutText = await barcodes.render({
      symbology: Symbology.EAN_13,
      value: '5901234123457',
      showText: false,
    });
    expect((withText.body as Buffer).length).not.toBe(
      (withoutText.body as Buffer).length,
    );
  });
});

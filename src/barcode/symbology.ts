/**
 * The symbologies SANTRACK can print, and what each one is for.
 *
 * One code type is not enough. A book carries an ISBN because that is what a
 * bookshop's till reads; a shipping carton carries ITF-14 or GS1-128 because
 * that is what a warehouse scanner reads through shrink-wrap at a distance; a
 * vial too small for either carries a Data Matrix; and the platform's own
 * permanent identity travels as a QR because a phone camera can read it. The
 * same product can legitimately carry several at once, on different packaging
 * levels, and printing the wrong one means a scanner in the field simply does
 * not beep.
 *
 * Rendering is BWIPP by way of bwip-js, which is the reference implementation
 * of every one of these standards - check digits, quiet zones, module ratios
 * and the human-readable text line included. Nothing here re-implements a
 * specification; this file decides which of the hundred-odd symbologies BWIPP
 * knows are meaningful for traceability, and validates input before it reaches
 * the encoder so the caller gets a sentence rather than a PostScript error.
 */

/** What a symbology is physically capable of, which is what drives the UI. */
export enum SymbologyDimension {
  /** Bars and spaces. Read by a laser scanner; cannot survive being torn. */
  LINEAR = '1D',
  /** A matrix. Holds far more, and reads back from a partial image. */
  MATRIX = '2D',
}

/** What the code is normally printed on, so the picker can group sensibly. */
export enum SymbologyUse {
  /** The platform's own permanent identity. */
  IDENTITY = 'IDENTITY',
  /** Scanned at a retail till. */
  RETAIL = 'RETAIL',
  /** Books and other publications. */
  PUBLICATION = 'PUBLICATION',
  /** Cartons, pallets and shipping units. */
  LOGISTICS = 'LOGISTICS',
  /** Internal labels that never leave the business. */
  INTERNAL = 'INTERNAL',
}

export enum Symbology {
  QR = 'QR',
  GS1_QR = 'GS1_QR',
  DATA_MATRIX = 'DATA_MATRIX',
  GS1_DATA_MATRIX = 'GS1_DATA_MATRIX',
  PDF417 = 'PDF417',
  AZTEC = 'AZTEC',

  EAN_13 = 'EAN_13',
  EAN_8 = 'EAN_8',
  UPC_A = 'UPC_A',
  UPC_E = 'UPC_E',
  ISBN = 'ISBN',

  ITF_14 = 'ITF_14',
  GS1_128 = 'GS1_128',
  SSCC_18 = 'SSCC_18',

  CODE_128 = 'CODE_128',
  CODE_39 = 'CODE_39',
  CODE_93 = 'CODE_93',
  CODABAR = 'CODABAR',
}

/** The outcome of checking a value before it reaches the encoder. */
export interface ValidationResult {
  /** The value to hand BWIPP, normalised. Absent when the input is unusable. */
  value?: string;
  /** Why it was rejected, in the language the operator will understand. */
  problem?: string;
  /**
   * The encoder to use, when normalising had to change it. An ISBN given as
   * bare digits is an EAN-13, because that is exactly what it is.
   */
  bcid?: string;
  /** Text to print under the bars in place of the encoded value. */
  alttext?: string;
}

export interface SymbologySpec {
  symbology: Symbology;
  /** The BWIPP encoder name. */
  bcid: string;
  label: string;
  dimension: SymbologyDimension;
  use: SymbologyUse;
  /** One sentence: what this is for and when to reach for it. */
  purpose: string;
  /** What the operator should type, in plain words. */
  accepts: string;
  /** A value that renders, used by the picker's preview and by the tests. */
  example: string;
  /** Whether the human-readable line under the bars is normal for this code. */
  printsText: boolean;
  /** Checks and normalises. Returns the value BWIPP should encode. */
  validate(raw: string): ValidationResult;
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

const digitsOnly = (raw: string) => raw.replace(/[\s-]/g, '');

/**
 * Every GTIN-family code ends in a modulo-10 check digit. BWIPP will compute a
 * missing one, but it will also happily encode a wrong one, and a barcode
 * whose check digit disagrees with its own digits is worse than no barcode:
 * it scans, and it scans as something else.
 */
function gtinCheckDigit(digits: string): string {
  let sum = 0;
  // Weights alternate 3/1 from the right, whatever the length.
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(digits[i]) * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Builds a validator for the fixed-length numeric codes (EAN, UPC, ITF-14,
 * SSCC). `length` counts the check digit; a value one short of it is accepted
 * and completed, which is what a catalogue usually holds.
 */
function numeric(length: number, name: string) {
  return (raw: string): ValidationResult => {
    const value = digitsOnly(raw);

    if (!/^\d+$/.test(value)) {
      return { problem: `${name} is digits only - got "${raw.trim()}"` };
    }
    if (value.length === length - 1) {
      return { value: value + gtinCheckDigit(value) };
    }
    if (value.length !== length) {
      return {
        problem: `${name} is ${length} digits (or ${length - 1}, and we will work out the check digit) - got ${value.length}`,
      };
    }

    const expected = gtinCheckDigit(value.slice(0, -1));
    if (value.slice(-1) !== expected) {
      return {
        problem: `Check digit is wrong: ${value} should end in ${expected}, not ${value.slice(-1)}. A code that scans as the wrong product is worse than none.`,
      };
    }
    return { value };
  };
}

/** Anything printable is encodable; the check is that something was typed. */
function freeText(name: string, pattern?: RegExp, expectation?: string) {
  return (raw: string): ValidationResult => {
    const value = raw.trim();
    if (!value) {
      return { problem: `${name} needs a value to encode` };
    }
    if (pattern && !pattern.test(value)) {
      return { problem: expectation };
    }
    return { value };
  };
}

/**
 * GS1 element strings: one or more application identifiers in brackets,
 * each followed by its data - `(01)09501101020917(10)LOT-A`.
 */
function gs1ElementString(name: string) {
  return (raw: string): ValidationResult => {
    const value = raw.trim();
    if (!value) {
      return { problem: `${name} needs at least one application identifier` };
    }
    if (!/^\(\d{2,4}\)/.test(value)) {
      return {
        problem: `${name} carries GS1 application identifiers in brackets, e.g. (01)09501101020917(10)LOT-A - got "${value}"`,
      };
    }
    return { value };
  };
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const SYMBOLOGIES: Record<Symbology, SymbologySpec> = {
  // ── 2D ──────────────────────────────────────────────────────────────────
  [Symbology.QR]: {
    symbology: Symbology.QR,
    bcid: 'qrcode',
    label: 'QR Code',
    dimension: SymbologyDimension.MATRIX,
    use: SymbologyUse.IDENTITY,
    purpose:
      'The platform default. Any phone camera reads it, it survives a torn label, and it is what a consumer scans to verify a product.',
    accepts: 'Any text. SANTRACK encodes the identity token and nothing else.',
    example: 'ST-QR-000001-4F2A9C',
    printsText: false,
    validate: freeText('QR'),
  },
  [Symbology.GS1_QR]: {
    symbology: Symbology.GS1_QR,
    bcid: 'gs1qrcode',
    label: 'GS1 QR Code',
    dimension: SymbologyDimension.MATRIX,
    use: SymbologyUse.RETAIL,
    purpose:
      'A QR carrying GS1 application identifiers, so one code answers both the till and the phone. This is what a GS1 Digital Link label prints.',
    accepts: 'GS1 element string, e.g. (01)09501101020917(10)LOT-A(17)261231',
    example: '(01)09501101020917(10)LOT-A(17)261231',
    printsText: false,
    validate: gs1ElementString('GS1 QR'),
  },
  [Symbology.DATA_MATRIX]: {
    symbology: Symbology.DATA_MATRIX,
    bcid: 'datamatrix',
    label: 'Data Matrix',
    dimension: SymbologyDimension.MATRIX,
    use: SymbologyUse.IDENTITY,
    purpose:
      'The smallest readable 2D code. Reach for it when the item is too small for a QR - ampoules, vials, components, electronics.',
    accepts: 'Any text.',
    example: 'ST-QR-000001-4F2A9C',
    printsText: false,
    validate: freeText('Data Matrix'),
  },
  [Symbology.GS1_DATA_MATRIX]: {
    symbology: Symbology.GS1_DATA_MATRIX,
    bcid: 'gs1datamatrix',
    label: 'GS1 Data Matrix',
    dimension: SymbologyDimension.MATRIX,
    use: SymbologyUse.RETAIL,
    purpose:
      'The pharmaceutical serialisation standard: product code, batch, expiry and serial in one small mark. Required on medicine packs in most regulated markets.',
    accepts: 'GS1 element string, e.g. (01)09501101020917(17)261231(10)LOT-A(21)SN123',
    example: '(01)09501101020917(17)261231(10)LOT-A(21)SN123',
    printsText: false,
    validate: gs1ElementString('GS1 Data Matrix'),
  },
  [Symbology.PDF417]: {
    symbology: Symbology.PDF417,
    bcid: 'pdf417',
    label: 'PDF417',
    dimension: SymbologyDimension.MATRIX,
    use: SymbologyUse.LOGISTICS,
    purpose:
      'A stacked code that holds a paragraph rather than an identifier. Used on shipping documents, permits and identity cards where the paper must carry the data itself.',
    accepts: 'Any text, including long payloads.',
    example: 'ST-QR-000001-4F2A9C',
    printsText: false,
    validate: freeText('PDF417'),
  },
  [Symbology.AZTEC]: {
    symbology: Symbology.AZTEC,
    bcid: 'azteccode',
    label: 'Aztec Code',
    dimension: SymbologyDimension.MATRIX,
    use: SymbologyUse.LOGISTICS,
    purpose:
      'Needs no quiet zone, so it fits where a QR will not. Standard on transport tickets and waybills.',
    accepts: 'Any text.',
    example: 'ST-QR-000001-4F2A9C',
    printsText: false,
    validate: freeText('Aztec'),
  },

  // ── Retail ──────────────────────────────────────────────────────────────
  [Symbology.EAN_13]: {
    symbology: Symbology.EAN_13,
    bcid: 'ean13',
    label: 'EAN-13',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.RETAIL,
    purpose:
      'The retail barcode used everywhere outside North America. This is the GTIN a till reads at the point of sale.',
    accepts: '13 digits, or 12 and we will work out the check digit.',
    example: '5901234123457',
    printsText: true,
    validate: numeric(13, 'EAN-13'),
  },
  [Symbology.EAN_8]: {
    symbology: Symbology.EAN_8,
    bcid: 'ean8',
    label: 'EAN-8',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.RETAIL,
    purpose:
      'The short EAN, for packs with no room for thirteen digits - sachets, sweets, small cosmetics.',
    accepts: '8 digits, or 7 and we will work out the check digit.',
    example: '96385074',
    printsText: true,
    validate: numeric(8, 'EAN-8'),
  },
  [Symbology.UPC_A]: {
    symbology: Symbology.UPC_A,
    bcid: 'upca',
    label: 'UPC-A',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.RETAIL,
    purpose:
      'The North American retail barcode. Print it when the product is destined for the United States or Canada.',
    accepts: '12 digits, or 11 and we will work out the check digit.',
    example: '012345678905',
    printsText: true,
    validate: numeric(12, 'UPC-A'),
  },
  [Symbology.UPC_E]: {
    symbology: Symbology.UPC_E,
    bcid: 'upce',
    label: 'UPC-E',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.RETAIL,
    purpose:
      'A UPC-A compressed to six data digits for small North American packs.',
    accepts: '8 digits, or 7 and we will work out the check digit.',
    example: '01234565',
    printsText: true,
    validate: numeric(8, 'UPC-E'),
  },
  [Symbology.ISBN]: {
    symbology: Symbology.ISBN,
    bcid: 'isbn',
    label: 'ISBN',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.PUBLICATION,
    purpose:
      'The book barcode: an EAN-13 under a printed "ISBN 978-..." line, optionally with a price add-on. Booksellers and libraries read the line as well as the bars.',
    accepts:
      'The ISBN as printed on the book, hyphenated - 978-0-306-40615-7. A price add-on may follow after a space: 978-0-306-40615-7 51999.',
    example: '978-0-306-40615-7',
    printsText: true,
    validate: validateIsbn,
  },

  // ── Logistics ───────────────────────────────────────────────────────────
  [Symbology.ITF_14]: {
    symbology: Symbology.ITF_14,
    bcid: 'itf14',
    label: 'ITF-14',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.LOGISTICS,
    purpose:
      'The carton code. Its wide bars survive printing straight onto corrugated board and read through shrink-wrap, which retail codes do not.',
    accepts: '14 digits, or 13 and we will work out the check digit.',
    example: '00123456789012',
    printsText: true,
    validate: numeric(14, 'ITF-14'),
  },
  [Symbology.GS1_128]: {
    symbology: Symbology.GS1_128,
    bcid: 'gs1-128',
    label: 'GS1-128',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.LOGISTICS,
    purpose:
      'The workhorse of the shipping label: batch, expiry, quantity and serial alongside the product code, each tagged with its GS1 application identifier.',
    accepts: 'GS1 element string, e.g. (01)09501101020917(10)LOT-A(17)261231',
    example: '(01)09501101020917(10)LOT-A(17)261231',
    printsText: true,
    validate: gs1ElementString('GS1-128'),
  },
  [Symbology.SSCC_18]: {
    symbology: Symbology.SSCC_18,
    bcid: 'sscc18',
    label: 'SSCC-18',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.LOGISTICS,
    purpose:
      'The serial shipping container code: the licence plate for one pallet or one consignment, unique worldwide and never reused.',
    accepts: '18 digits, or 17 and we will work out the check digit.',
    example: '006141411234567890',
    printsText: true,
    validate: validateSscc,
  },

  // ── Internal ────────────────────────────────────────────────────────────
  [Symbology.CODE_128]: {
    symbology: Symbology.CODE_128,
    bcid: 'code128',
    label: 'Code 128',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.INTERNAL,
    purpose:
      'The general-purpose linear code. Dense, reads any ASCII, and the right answer for internal labels - bin locations, work orders, our own item codes.',
    accepts: 'Any printable ASCII.',
    example: 'ST-LPT-000001',
    printsText: true,
    validate: freeText('Code 128'),
  },
  [Symbology.CODE_39]: {
    symbology: Symbology.CODE_39,
    bcid: 'code39',
    label: 'Code 39',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.INTERNAL,
    purpose:
      'The older industrial code. Less dense than Code 128, but still what a lot of installed warehouse and defence equipment expects.',
    accepts: 'Digits, capital letters, space and - . $ / + %',
    example: 'ST-LPT-000001',
    printsText: true,
    validate: validateCode39,
  },
  [Symbology.CODE_93]: {
    symbology: Symbology.CODE_93,
    bcid: 'code93',
    label: 'Code 93',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.INTERNAL,
    purpose:
      'Code 39 made denser and given two check characters. Useful where the label is small and the scanner is old.',
    accepts: 'Any printable ASCII.',
    example: 'ST-LPT-000001',
    printsText: true,
    validate: freeText('Code 93'),
  },
  [Symbology.CODABAR]: {
    symbology: Symbology.CODABAR,
    bcid: 'rationalizedCodabar',
    label: 'Codabar',
    dimension: SymbologyDimension.LINEAR,
    use: SymbologyUse.INTERNAL,
    purpose:
      'Still standard in blood banks, laboratories and library circulation, which is the only reason to print one today.',
    accepts:
      'Digits and - $ : / . + , between a start and stop letter A, B, C or D - A12345B',
    example: 'A12345678B',
    printsText: true,
    validate: validateCodabar,
  },
};

// ---------------------------------------------------------------------------
// The validators that need more than a pattern
// ---------------------------------------------------------------------------

/**
 * ISBN is an EAN-13 with a 978 or 979 prefix and a printed ISBN line above the
 * bars. BWIPP's ISBN encoder builds that line, but it needs the hyphenation to
 * do it, and hyphen positions depend on the registration group - a table this
 * platform has no business carrying.
 *
 * So: a hyphenated ISBN goes to the ISBN encoder and gets the proper printed
 * line. Bare digits go to EAN-13 instead, which produces exactly the same
 * bars, with the ISBN shown underneath unhyphenated rather than hyphenated
 * wrongly. A misplaced hyphen on a book jacket is a real error - it names a
 * publisher that did not publish the book.
 */
export function validateIsbn(raw: string): ValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { problem: 'ISBN needs a value' };
  }

  const [isbnPart, addOn] = trimmed.split(/\s+/, 2);
  if (addOn && !/^(\d{2}|\d{5})$/.test(addOn)) {
    return {
      problem: `A price add-on is 2 or 5 digits - got "${addOn}". Example: 978-0-306-40615-7 51999`,
    };
  }

  const digits = isbnPart.replace(/-/g, '');
  if (!/^\d{9}[\dX]$|^\d{13}$/i.test(digits)) {
    return {
      problem: `An ISBN is 13 digits (or a 10-character ISBN-10) - got "${isbnPart}"`,
    };
  }

  if (digits.length === 13) {
    if (!/^97[89]/.test(digits)) {
      return {
        problem: `A 13-digit ISBN starts 978 or 979 - got ${digits.slice(0, 3)}. Anything else is an ordinary EAN-13, not a book.`,
      };
    }

    const expected = gtinCheckDigit(digits.slice(0, 12));
    if (digits.slice(-1) !== expected) {
      return {
        problem: `Check digit is wrong: this ISBN should end in ${expected}, not ${digits.slice(-1)}`,
      };
    }
  }

  // Hyphenated: BWIPP can build the ISBN text line itself.
  const dashes = (isbnPart.match(/-/g) ?? []).length;
  if (dashes >= 3) {
    return { value: trimmed };
  }

  // Bare digits: identical bars via EAN-13, honest text underneath.
  if (digits.length === 13) {
    return {
      value: addOn ? `${digits} ${addOn}` : digits,
      bcid: 'ean13',
      alttext: `ISBN ${digits}`,
    };
  }

  return {
    problem:
      'Enter a 10-digit ISBN hyphenated as printed on the book, e.g. 0-306-40615-2 - the hyphen positions identify the publisher and cannot be guessed.',
  };
}

/**
 * SSCC-18 is carried as GS1 application identifier 00, and BWIPP's encoder
 * expects it written that way. Operators read the number off a pallet label as
 * eighteen bare digits, so both forms are accepted here and normalised to the
 * one the encoder wants.
 */
export function validateSscc(raw: string): ValidationResult {
  const bracketed = raw.trim().match(/^\(00\)(\d+)$/);
  const digits = bracketed ? bracketed[1] : digitsOnly(raw);

  if (!/^\d+$/.test(digits)) {
    return { problem: `SSCC-18 is digits only - got "${raw.trim()}"` };
  }
  if (digits.length === 17) {
    return { value: `(00)${digits}${gtinCheckDigit(digits)}` };
  }
  if (digits.length !== 18) {
    return {
      problem: `SSCC-18 is 18 digits (or 17, and we will work out the check digit) - got ${digits.length}`,
    };
  }

  const expected = gtinCheckDigit(digits.slice(0, -1));
  if (digits.slice(-1) !== expected) {
    return {
      problem: `Check digit is wrong: this SSCC should end in ${expected}, not ${digits.slice(-1)}`,
    };
  }
  return { value: `(00)${digits}` };
}

/**
 * Code 39 has no lower case. Rather than refuse an operator who typed their
 * own item code in lower case, this upper-cases it - the encoded value is the
 * same symbol either way, and Code 39 readers report upper case regardless.
 */
export function validateCode39(raw: string): ValidationResult {
  const value = raw.trim().toUpperCase();
  if (!value) {
    return { problem: 'Code 39 needs a value to encode' };
  }
  if (!/^[0-9A-Z\-. $/+%]+$/.test(value)) {
    const bad = [...new Set(value.replace(/[0-9A-Z\-. $/+%]/g, ''))].join(' ');
    return {
      problem: `Code 39 cannot carry ${bad} - it holds digits, capital letters, space and - . $ / + % only. Use Code 128 for anything else.`,
    };
  }
  return { value };
}

/** Codabar carries its start and stop characters in the data. */
export function validateCodabar(raw: string): ValidationResult {
  const value = raw.trim().toUpperCase();
  if (!value) {
    return { problem: 'Codabar needs a value to encode' };
  }
  if (!/^[A-D][0-9\-$:/.+,]*[A-D]$/.test(value)) {
    return {
      problem:
        'Codabar runs from a start letter to a stop letter, both one of A B C D, with digits and - $ : / . + , between them. Example: A12345B',
    };
  }
  return { value };
}

// ---------------------------------------------------------------------------
// Choosing one
// ---------------------------------------------------------------------------

/**
 * What to print by default, given what the label is going on.
 *
 * These are defaults, not rules - the operator can always pick another - but
 * they encode the ordinary answer so nobody has to know the difference between
 * ITF-14 and EAN-13 to print a carton label.
 */
export const DEFAULT_SYMBOLOGY: Record<SymbologyUse, Symbology> = {
  [SymbologyUse.IDENTITY]: Symbology.QR,
  [SymbologyUse.RETAIL]: Symbology.EAN_13,
  [SymbologyUse.PUBLICATION]: Symbology.ISBN,
  [SymbologyUse.LOGISTICS]: Symbology.ITF_14,
  [SymbologyUse.INTERNAL]: Symbology.CODE_128,
};

export function isSymbology(value: string): value is Symbology {
  return Object.values(Symbology).includes(value as Symbology);
}

export function specFor(symbology: Symbology): SymbologySpec {
  return SYMBOLOGIES[symbology];
}

/** The catalogue as the picker renders it, grouped and ordered. */
export function catalogue(): SymbologySpec[] {
  return Object.values(Symbology).map((symbology) => SYMBOLOGIES[symbology]);
}

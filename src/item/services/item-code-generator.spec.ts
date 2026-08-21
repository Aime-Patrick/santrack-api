import { normalise } from './item-code-generator.service';

describe('label prefixes', () => {
  it('keeps a short alphanumeric token', () => {
    expect(normalise('LPT')).toBe('LPT');
  });

  it('uppercases and strips punctuation from a SKU', () => {
    expect(normalise('lpt-t14/2026')).toBe('LPTT');
  });

  it('truncates to four characters so labels stay readable', () => {
    expect(normalise('THINKPADT14GEN5')).toBe('THIN');
  });

  it('falls back when a product has no usable SKU', () => {
    // A printed label with an empty prefix is unreadable, and an operator
    // reading a code aloud needs something to say.
    expect(normalise(null)).toBe('ITM');
    expect(normalise('')).toBe('ITM');
    expect(normalise('---')).toBe('ITM');
  });
});

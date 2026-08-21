import { escapeField, needsQuoting, toCsv, toCsvExport } from './reporting.csv';

describe('the dependency-free CSV export (proposal section 22)', () => {
  it('escapes a field containing a comma, quote or newline', () => {
    expect(needsQuoting('plain')).toBe(false);
    expect(needsQuoting('with,comma')).toBe(true);
    expect(needsQuoting('with"quote')).toBe(true);
    expect(needsQuoting('with\nnewline')).toBe(true);
  });

  it('doubles internal quotes', () => {
    expect(escapeField('say "hi"')).toBe('"say ""hi"""');
  });

  it('writes null and undefined as empty fields', () => {
    expect(escapeField(null)).toBe('');
    expect(escapeField(undefined)).toBe('');
    expect(escapeField(0)).toBe('0');
    expect(escapeField('')).toBe('');
  });

  it('emits headers from the first row and CRLF line endings', () => {
    const csv = toCsv([
      { reference: 'PO-1', units: 5 },
      { reference: 'PO,2', units: 10 },
    ]);
    expect(csv).toBe('reference,units\r\nPO-1,5\r\n"PO,2",10\r\n');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('builds an export envelope with filename and content type', () => {
    const export_ = toCsvExport('production', [{ orderNumber: 'PO-1' }]);
    expect(export_.filename).toBe('production.csv');
    expect(export_.contentType).toContain('text/csv');
    expect(export_.body).toBe('orderNumber\r\nPO-1\r\n');
  });
});
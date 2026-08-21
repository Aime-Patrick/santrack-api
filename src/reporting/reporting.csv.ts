/**
 * A dependency-free CSV writer for report export (technical proposal section
 * 22: reports can be exported as PDF, Excel or CSV). The rows come in as
 * objects; the headers are the first row's keys in insertion order, so a
 * report is a plain array and the export is a string.
 *
 * The escaping rules follow RFC 4180: a field containing a comma, a quote or
 * a newline is wrapped in quotes and internal quotes are doubled. Numbers are
 * written as they are; money stays a string until the moment it lands in the
 * caller's spreadsheet, so nothing drifts through a float on the way out.
 */

/** True when a field must be quoted to survive a round-trip through Excel. */
export function needsQuoting(value: string): boolean {
  return /[",\r\n]/.test(value);
}

export function escapeField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!needsQuoting(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = rows.map((row) =>
    headers.map((header) => escapeField(row[header])).join(','),
  );
  return [headers.join(','), ...lines].join('\r\n') + '\r\n';
}

/**
 * A report export envelope. The rows are the same ones the JSON endpoint
 * returns, so the CSV never says something different from the screen.
 */
export interface ReportExport {
  filename: string;
  contentType: string;
  body: string;
}

export function toCsvExport(name: string, rows: Record<string, unknown>[]): ReportExport {
  return {
    filename: `${name}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: toCsv(rows),
  };
}
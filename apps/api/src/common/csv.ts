/**
 * Minimal RFC 4180 CSV for dashboard exports. Pure, dependency-free, tested.
 * Values containing a comma, quote, CR or LF are double-quoted with internal
 * quotes doubled; null/undefined become empty cells. Output starts with a
 * UTF-8 BOM so Excel opens accented names correctly.
 */

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvDocument(
  header: string[],
  rows: unknown[][],
): string {
  const lines = [
    header.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ];
  return `\uFEFF${lines.join('\n')}\n`;
}

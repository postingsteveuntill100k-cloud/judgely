/** RFC 4180 CSV writer. Formula-injection safe: cells starting with = + - @ are prefixed. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export function csvDocument(headers: string[], rows: unknown[][]): string {
  const out = [csvRow(headers)];
  for (const r of rows) out.push(csvRow(r));
  return out.join('\r\n') + '\r\n';
}

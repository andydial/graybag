// Writing a CSV the importer can read straight back — `E10-21`.
//
// The round trip is the whole point: `--export-dishes` must produce a file `--dishes` accepts
// without editing anything but the cells. So the quoting rules here are the mirror of
// `parse.mjs`'s, and `csv-out.test.mjs` asserts that by parsing what this writes.

/**
 * Quote a cell if, and only if, it needs it.
 *
 * A value containing a comma, a quote or a newline must be quoted, and an embedded quote is
 * doubled — RFC 4180, which is what `parseCsv` implements. Quoting everything would also be
 * correct and is deliberately not done: a file somebody opens to edit one column reads better
 * without a screen of quotation marks, and the parser handles both.
 *
 * A leading or trailing space is quoted too. `parseCsv` trims values, so an unquoted " veg" would
 * come back as "veg" — harmless here, but the asymmetry is the kind that bites later.
 */
function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Rows of objects to CSV text, with the header taken from the first row's keys.
 *
 * CRLF, because Excel is where this file is going and it is what Excel writes itself. `parseCsv`
 * reads either.
 */
export function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(headers.map((h) => cell(row[h])).join(','));
  return lines.join('\r\n') + '\r\n';
}

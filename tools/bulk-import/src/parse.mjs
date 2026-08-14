// Reading the file, and nothing else.
//
// CSV or JSON, decided by extension. Parsing is separated from validation because the two fail
// differently and the operator needs to be told which happened: "your file is not a CSV" and
// "row 12 has no school code" are different problems with different fixes, and collapsing them
// into "import failed" is how an import day turns into a debugging day.
//
// ## Why a CSV parser is written here rather than pulled in
//
// The repository has no CSV dependency and adding one for a one-day tool is a poor trade. What
// is needed is small and completely specified: RFC 4180 quoting, embedded commas, embedded
// newlines, doubled quotes, and a UTF-8 BOM — which is what Excel on Windows writes and is the
// single likeliest thing to arrive from a Bubble export opened and re-saved. It is tested
// directly in `test/parse.test.mjs`.
//
// What this deliberately does NOT do: type coercion, trimming of interior whitespace, or header
// normalisation beyond case and surrounding space. A value is delivered as the string the file
// held, and turning it into a number or a boolean is validation's job, where a failure can name
// the row.

/** Thrown when the bytes are not the file they claim to be. Never used for a bad *value*. */
export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Split CSV text into rows of raw cells.
 *
 * A single pass over the characters rather than a line split, because a quoted field may contain
 * a newline — an address of "12 Industrial Area\nPhase 8" is not exotic and a line-based parser
 * silently produces two broken rows from it.
 */
export function parseCsvRows(text) {
  // Excel writes a UTF-8 BOM. Left in place it becomes part of the FIRST header name, so `code`
  // arrives as `\uFEFFcode` and every row reports a missing code — with the header looking
  // correct in every editor that hides the BOM.
  //
  // Written as an escape rather than the character itself: a literal BOM in source is invisible,
  // and `no-irregular-whitespace` fails the build on it for exactly that reason.
  const src = text.replace(/^\uFEFF/, '');

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      // CRLF and a lone CR both end the row. Excel writes CRLF.
      if (src[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  if (quoted) {
    throw new ParseError(
      'the file ends inside a quoted value — a `"` is unclosed. Usually a stray quote in a ' +
        'description or an address.',
    );
  }

  // A file ending in a newline must not produce a trailing empty row.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

const normaliseHeader = (h) => h.trim().toLowerCase().replace(/\s+/g, '_');

/**
 * CSV text to objects, keyed by header.
 *
 * Rows are numbered as the operator sees them **in the spreadsheet**: the header is row 1, so the
 * first data row is row 2. Reporting a zero-based index against a file somebody is about to open
 * in Excel is a small cruelty that costs real minutes.
 */
export function parseCsv(text) {
  const rows = parseCsvRows(text).filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (rows.length === 0) throw new ParseError('the file is empty');

  const headers = rows[0].map(normaliseHeader);
  const seen = new Set();
  for (const h of headers) {
    if (h === '') throw new ParseError('one of the column headings is blank');
    if (seen.has(h)) throw new ParseError(`the column "${h}" appears twice`);
    seen.add(h);
  }

  return rows.slice(1).map((cells, i) => {
    const record = { __row: i + 2 };
    headers.forEach((h, c) => {
      record[h] = (cells[c] ?? '').trim();
    });
    return record;
  });
}

/**
 * JSON to the same shape.
 *
 * Accepts either a bare array or `{ "schools": [...] }` — the second is what a hand-written file
 * tends to look like, and refusing it would be pedantry.
 */
export function parseJson(text, key) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new ParseError(`the file is not valid JSON: ${cause.message}`);
  }

  const list = Array.isArray(data) ? data : key && Array.isArray(data[key]) ? data[key] : null;
  if (list === null) {
    throw new ParseError(
      key
        ? `expected a JSON array, or an object with a "${key}" array`
        : 'expected a JSON array',
    );
  }

  return list.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ParseError(`entry ${i + 1} is not an object`);
    }
    // `__row` for JSON is the position in the array, one-based. There is no header line, so
    // unlike CSV the first entry is 1.
    const record = { __row: i + 1 };
    for (const [k, v] of Object.entries(item)) {
      record[normaliseHeader(k)] = v === null || v === undefined ? '' : String(v).trim();
    }
    return record;
  });
}

/** Parse by extension. `key` names the array a JSON object form may wrap. */
export function parseFile(filename, text, key) {
  if (/\.json$/i.test(filename)) return parseJson(text, key);
  if (/\.csv$/i.test(filename)) return parseCsv(text);
  throw new ParseError(`${filename}: expected a .csv or .json file`);
}

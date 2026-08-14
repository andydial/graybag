import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ParseError, parseCsv, parseFile, parseJson } from '../src/parse.mjs';

test('reads a simple CSV into objects keyed by header', () => {
  const rows = parseCsv('code,name\namity,Amity International\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'amity');
  assert.equal(rows[0].name, 'Amity International');
});

test('numbers rows as the spreadsheet shows them — the first data row is 2', () => {
  // Reporting a zero-based index against a file somebody is about to open in Excel costs real
  // minutes on an import day.
  const rows = parseCsv('code\na\nb\n');
  assert.equal(rows[0].__row, 2);
  assert.equal(rows[1].__row, 3);
});

test('strips the UTF-8 BOM Excel writes', () => {
  // Left in place the BOM becomes part of the first header, so `code` arrives as `\uFEFFcode`
  // and every row reports a missing code — while the header looks perfect in any editor.
  const rows = parseCsv('\uFEFFcode,name\namity,Amity\n');
  assert.equal(rows[0].code, 'amity');
  assert.deepEqual(Object.keys(rows[0]).includes('code'), true);
});

test('handles a quoted field containing a comma', () => {
  const rows = parseCsv('code,address\namity,"12 Phase 8, Mohali"\n');
  assert.equal(rows[0].address, '12 Phase 8, Mohali');
});

test('handles a quoted field containing a newline', () => {
  // A line-based parser silently produces two broken rows from this, and an address across two
  // lines is not exotic.
  const rows = parseCsv('code,address\namity,"12 Industrial Area\nPhase 8"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, '12 Industrial Area\nPhase 8');
});

test('handles a doubled quote inside a quoted field', () => {
  const rows = parseCsv('code,name\namity,"The ""Big"" School"\n');
  assert.equal(rows[0].name, 'The "Big" School');
});

test('handles CRLF line endings', () => {
  const rows = parseCsv('code,name\r\namity,Amity\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Amity');
});

test('normalises headers to lower snake case', () => {
  const rows = parseCsv('School Code,Contact Email\namity,a@b.com\n');
  assert.equal(rows[0].school_code, 'amity');
  assert.equal(rows[0].contact_email, 'a@b.com');
});

test('refuses a duplicate column rather than silently keeping one', () => {
  assert.throws(() => parseCsv('code,code\na,b\n'), ParseError);
});

test('refuses a blank column heading', () => {
  assert.throws(() => parseCsv('code,,name\na,b,c\n'), ParseError);
});

test('refuses a file that ends inside a quoted value', () => {
  assert.throws(() => parseCsv('code\n"unclosed\n'), /unclosed/);
});

test('refuses an empty file', () => {
  assert.throws(() => parseCsv(''), ParseError);
});

test('a trailing newline does not produce an empty row', () => {
  assert.equal(parseCsv('code\na\n').length, 1);
});

test('missing trailing cells arrive as empty strings, not undefined', () => {
  // A short row is what a spreadsheet writes when the last columns are blank. Validation must
  // see "" and report "required and is blank", not crash on undefined.
  const rows = parseCsv('code,name,postcode\namity,Amity\n');
  assert.equal(rows[0].postcode, '');
});

test('reads a bare JSON array', () => {
  const rows = parseJson('[{"code":"amity","name":"Amity"}]');
  assert.equal(rows[0].code, 'amity');
  assert.equal(rows[0].__row, 1);
});

test('reads a JSON object wrapping a named array', () => {
  const rows = parseJson('{"schools":[{"code":"amity"}]}', 'schools');
  assert.equal(rows[0].code, 'amity');
});

test('JSON nulls become empty strings so validation reports them uniformly', () => {
  const rows = parseJson('[{"code":"amity","postcode":null}]');
  assert.equal(rows[0].postcode, '');
});

test('JSON numbers are stringified rather than coerced here', () => {
  // Coercion is validation's job, where a failure can name the row and the column.
  const rows = parseJson('[{"price_paise":4500}]');
  assert.equal(rows[0].price_paise, '4500');
});

test('refuses JSON that is not an array of objects', () => {
  assert.throws(() => parseJson('[1,2,3]'), ParseError);
  assert.throws(() => parseJson('{"nope":1}', 'schools'), ParseError);
  assert.throws(() => parseJson('not json'), ParseError);
});

test('parseFile picks the parser by extension and refuses anything else', () => {
  assert.equal(parseFile('a.csv', 'code\nx\n')[0].code, 'x');
  assert.equal(parseFile('a.json', '[{"code":"x"}]')[0].code, 'x');
  assert.throws(() => parseFile('a.xlsx', ''), /expected a .csv or .json/);
});

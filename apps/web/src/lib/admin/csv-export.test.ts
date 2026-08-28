import { describe, expect, it } from 'vitest';

import type { api } from '@graybag/shared';

import { csvField, csvFilename, ordersToCsv, reportToCsv } from './csv-export.js';

const bucket = (over: Record<string, unknown> = {}) => ({
  key: '2026-08-17', label: '2026-08-17',
  orders: 10, paid: 8, pending: 1, cancelled: 1,
  grossPaise: 100800, pendingPaise: 12600, taxPaise: 4800,
  refundedPaise: 0, netPaise: 100800,
  ...over,
}) as never;

const opts = { by: 'day' as const, from: '2026-08-01', to: '2026-08-26', label: (k: string) => k };

describe('csvField', () => {
  it('quotes a value containing a comma', () => {
    // Not an edge case: "Amity International, Mohali" is in the production data today.
    expect(csvField('Amity International, Mohali')).toBe('"Amity International, Mohali"');
  });

  it('doubles an embedded quote, as RFC 4180 asks', () => {
    expect(csvField('The "Big" School')).toBe('"The ""Big"" School"');
  });

  it('quotes a value containing a newline', () => {
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralises a value that a spreadsheet would execute as a formula', () => {
    // A CSV that can run a formula is a CSV that can read the rest of the sheet and send it
    // somewhere. No school name starts with `=`, and a leading tab costs nothing.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      expect(csvField(dangerous).startsWith('\t') || csvField(dangerous).startsWith('"\t')).toBe(true);
    }
  });

  it('renders null and undefined as empty, not as the words', () => {
    // `String(null)` is "null", and a column of the word null in a finance export is worse than
    // a blank because it looks like data.
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
});

describe('reportToCsv', () => {
  it('writes money as a plain number a spreadsheet can sum', () => {
    // No symbol and no thousands separator: both turn the column into text, and the first thing
    // anybody does with this file is sum a column.
    const csv = reportToCsv([bucket()], opts);
    expect(csv).toContain('1008.00');
    expect(csv).not.toContain('₹');
    expect(csv).not.toMatch(/1,008/);
  });

  it('carries the range, the filter and the caveats into the file', () => {
    // An export outlives the screen and gets mailed on. Without this a reader reconciles it
    // against something else and finds a discrepancy that is not there.
    const csv = reportToCsv([bucket()], { ...opts, schoolName: 'Amity' });
    expect(csv).toContain('2026-08-01');
    expect(csv).toContain('Amity');
    expect(csv).toMatch(/not revenue/i);
  });

  it('says "All schools" when no filter is set, rather than leaving it blank', () => {
    expect(reportToCsv([bucket()], opts)).toContain('All schools');
  });

  it('totals the rows, so the file can be checked against the screen', () => {
    const csv = reportToCsv([bucket(), bucket({ key: '2026-08-18', paid: 2, netPaise: 25200 })], opts);
    const total = csv.trim().split('\r\n').at(-1) ?? '';
    expect(total.startsWith('Total,')).toBe(true);
    expect(total).toContain('10');       // 8 + 2 paid
    expect(total).toContain('1260.00');  // 100800 + 25200
  });

  it('names the first column after the grouping', () => {
    expect(reportToCsv([bucket()], { ...opts, by: 'school' })).toMatch(/^School,/m);
    expect(reportToCsv([bucket()], { ...opts, by: 'month' })).toMatch(/^Month,/m);
  });

  it('uses the school name, not the key, when grouped by school', () => {
    // The key is a uuid. A file of uuids is a file nobody can read.
    const csv = reportToCsv([bucket({ key: 'uuid-1', label: 'Gem Public School' })], { ...opts, by: 'school' });
    expect(csv).toContain('Gem Public School');
    expect(csv).not.toContain('uuid-1');
  });

  it('leaves the average blank rather than dividing by zero', () => {
    const csv = reportToCsv([bucket({ paid: 0, netPaise: 0 })], opts);
    expect(csv).not.toContain('NaN');
    expect(csv).not.toContain('Infinity');
  });

  it('survives an empty report without emitting a broken file', () => {
    const csv = reportToCsv([], opts);
    expect(csv).toContain('Total');
    expect(csv).not.toContain('NaN');
  });

  it('carries no child field in the data, structurally', () => {
    // `Bucket` has nowhere to put one. Asserted anyway, because this is the guarantee somebody
    // would most plausibly break by adding "just one more column" to an export.
    //
    // Scoped to the data rows on purpose. The first version searched the whole file and matched
    // the word "class" — in this file's own note saying that no class appears in it. A test that
    // fails on its own reassurance is testing the wrong region, and deleting the note to make it
    // pass would have been exactly the wrong fix.
    const csv = reportToCsv([bucket()], opts);
    const data = csv.split('\r\n').filter((line) => !line.startsWith('#') && line !== '').join('\n');

    for (const field of ['recipient', 'class', 'section', 'allergy']) {
      expect(data.toLowerCase(), `"${field}" reached the data rows`).not.toContain(field);
    }
    // ...and the note itself is still there, because it is worth saying.
    expect(csv).toMatch(/no child’s name, class or section/i);
  });

  it('uses CRLF, which is what RFC 4180 and Excel expect', () => {
    expect(reportToCsv([bucket()], opts)).toContain('\r\n');
  });
});

describe('csvFilename', () => {
  it('sorts and reads without being opened', () => {
    expect(csvFilename('2026-08-01', '2026-08-26', 'revenue'))
      .toBe('graybag-revenue-2026-08-01-to-2026-08-26.csv');
  });
});

describe('ordersToCsv — E10-70', () => {
  const order = (o: Partial<api.AdminOrder> & { orderRef: string }): api.AdminOrder => ({
    id: `id-${o.orderRef}`, serviceDate: '2026-08-28', status: 'paid',
    schoolId: 's-1', schoolName: 'Amity International, Mohali', kitchenId: 'k-1',
    breakLabel: 'First break', recipientName: 'Demo Child', classLabel: '4', sectionLabel: 'B',
    subtotalPaise: 18_000, taxPaise: 900, discountPaise: 0, totalPaise: 18_900, refundedPaise: 0,
    ...o,
  });

  it('writes money as a plain decimal a spreadsheet can sum', () => {
    const csv = ordersToCsv([order({ orderRef: 'GB-1', totalPaise: 123_456 })], {
      serviceDate: '2026-08-28',
    });
    // The Total column, read as a field rather than searched for as a substring — `,189` appears
    // in a correct row too, because a comma precedes every value.
    const total = csv.split('\r\n').at(-1)!.split(',').at(-2);
    expect(total).toBe('1234.56');
    // No symbol and no thousands separator. `₹1,234.56` is text to a spreadsheet, and a column of
    // text is a column nobody can total.
    expect(total).not.toContain('₹');
    expect(Number(total)).toBe(1234.56);
  });

  it('quotes a school name containing a comma — the ordinary case here, not the edge case', () => {
    const csv = ordersToCsv([order({ orderRef: 'GB-1' })], { serviceDate: '2026-08-28' });
    expect(csv).toContain('"Amity International, Mohali"');
  });

  it('records the filters in force, so a saved file still says what it covers', () => {
    const csv = ordersToCsv([order({ orderRef: 'GB-1' })], {
      serviceDate: '2026-08-28', schoolName: 'Gem Public School', status: 'cancelled',
    });
    expect(csv).toContain('School,Gem Public School');
    expect(csv).toContain('Status,cancelled');
  });

  it('omits a filter line that is not in force rather than writing "all"', () => {
    const csv = ordersToCsv([order({ orderRef: 'GB-1' })], { serviceDate: '2026-08-28' });
    // The preamble only — the column header legitimately contains "School," and searching the
    // whole file for it was the assertion being wrong, not the code.
    const preamble = csv.split('\r\n\r\n')[0]!;
    expect(preamble).toBe('GrayBag orders,2026-08-28');
  });

  it('exports exactly the rows it is given — the file is the screen', () => {
    const csv = ordersToCsv(
      [order({ orderRef: 'GB-1' }), order({ orderRef: 'GB-2' })],
      { serviceDate: '2026-08-28' },
    );
    expect(csv.split('\r\n').filter((l) => l.startsWith('GB-'))).toHaveLength(2);
  });

  it('neutralises a leading formula character', () => {
    // A CSV that can run a formula is a CSV that can exfiltrate the rest of the sheet. The guard
    // is the leading tab; quoting is a separate concern and this value needs none, which is what
    // the first version of this test got wrong about its own subject.
    const csv = ordersToCsv([order({ orderRef: 'GB-1', recipientName: '=cmd()' })], {
      serviceDate: '2026-08-28',
    });
    // Asserted as a delimited substring rather than by splitting on commas: the school field is
    // quoted *because* it contains one, so naive splitting mis-parses the row — which is the
    // second time this test's own parsing, not the code, was the thing that was wrong.
    expect(csv).toContain(',\t=cmd(),');
    expect(csv).not.toContain(',=cmd(),');
  });

  it('writes a header even when the day is empty, so the file is not a blank page', () => {
    const csv = ordersToCsv([], { serviceDate: '2026-08-28' });
    expect(csv).toContain('Order,School,Child');
  });
});

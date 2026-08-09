import { describe, expect, it } from 'vitest';

import {
  packingCsv,
  packingList,
  perSchoolCsv,
  perSchoolTotals,
  productionCsv,
  productionTotals,
  type KitchenOrderLine,
} from './lists.js';

const line = (over: Partial<KitchenOrderLine> = {}): KitchenOrderLine => ({
  orderId: 'o1',
  schoolId: 'alpha',
  schoolName: 'Alpha Public School',
  breakId: 'b1',
  breakLabel: 'Lunch',
  dishId: 'd1',
  dishName: 'Veg Sandwich',
  quantity: 1,
  recipientName: 'Aarav',
  classLabel: '5',
  sectionLabel: 'A',
  pickupCode: null,
  ...over,
});

describe('productionTotals (E09-01)', () => {
  it('sums one dish across every school', () => {
    const totals = productionTotals([
      line({ quantity: 2 }),
      line({ schoolId: 'bravo', schoolName: 'Bravo', quantity: 3 }),
    ]);
    expect(totals).toEqual([{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 5 }]);
  });

  it('orders by biggest batch first — that is what gets started first', () => {
    const totals = productionTotals([
      line({ dishId: 'd1', dishName: 'Sandwich', quantity: 2 }),
      line({ dishId: 'd2', dishName: 'Wrap', quantity: 9 }),
    ]);
    expect(totals.map((d) => d.dishName)).toEqual(['Wrap', 'Sandwich']);
  });

  it('breaks ties alphabetically, so the printout is stable between runs', () => {
    // A list that reshuffles when two dishes tie is a list nobody trusts.
    const totals = productionTotals([
      line({ dishId: 'd2', dishName: 'Wrap', quantity: 4 }),
      line({ dishId: 'd1', dishName: 'Sandwich', quantity: 4 }),
    ]);
    expect(totals.map((d) => d.dishName)).toEqual(['Sandwich', 'Wrap']);
  });

  it('does not mutate its input', () => {
    const input = [line({ quantity: 2 })];
    const snapshot = JSON.parse(JSON.stringify(input));
    productionTotals(input);
    expect(input).toEqual(snapshot);
  });

  it('is empty for no orders, rather than throwing', () => {
    expect(productionTotals([])).toEqual([]);
  });
});

describe('perSchoolTotals (E09-02)', () => {
  it('splits by school and totals each', () => {
    const schools = perSchoolTotals([
      line({ quantity: 2 }),
      line({ dishId: 'd2', dishName: 'Wrap', quantity: 1 }),
      line({ schoolId: 'bravo', schoolName: 'Bravo International', quantity: 5 }),
    ]);

    expect(schools.map((s) => s.schoolName)).toEqual(['Alpha Public School', 'Bravo International']);
    expect(schools[0]?.totalItems).toBe(3);
    expect(schools[1]?.totalItems).toBe(5);
  });

  it('keeps each school independent', () => {
    // Sharing a totals object between groups makes two schools' numbers move together —
    // and the van is loaded from those numbers.
    const schools = perSchoolTotals([
      line({ quantity: 2 }),
      line({ schoolId: 'bravo', schoolName: 'Bravo', quantity: 7 }),
    ]);
    expect(schools[0]?.dishes[0]?.quantity).toBe(2);
    expect(schools[1]?.dishes[0]?.quantity).toBe(7);
  });
});

describe('packingList (E09-03)', () => {
  it('groups school then break then class then section', () => {
    const groups = packingList([
      line(),
      line({ breakId: 'b2', breakLabel: 'Break 2' }),
      line({ classLabel: '6', sectionLabel: 'B' }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.breakLabel).toBe('Break 2');
  });

  it('gives a child with two dishes ONE entry', () => {
    // Two rows for one child is how a child gets handed one bag and marked as served.
    const groups = packingList([
      line({ dishId: 'd1', dishName: 'Sandwich' }),
      line({ dishId: 'd2', dishName: 'Wrap' }),
    ]);
    expect(groups[0]?.entries).toHaveLength(1);
    expect(groups[0]?.entries[0]?.dishes).toHaveLength(2);
  });

  it('sums a repeated dish within one entry', () => {
    const groups = packingList([line({ quantity: 1 }), line({ quantity: 2 })]);
    expect(groups[0]?.entries[0]?.dishes[0]?.quantity).toBe(3);
  });

  it('keeps two children with the SAME NAME apart', () => {
    // Not hypothetical at a school of 1,500. Merging them hands one of them nothing.
    const groups = packingList([
      line({ orderId: 'o1', recipientName: 'Aarav', pickupCode: '1234' }),
      line({ orderId: 'o2', recipientName: 'Aarav', pickupCode: '5678' }),
    ]);
    expect(groups[0]?.entries).toHaveLength(2);
  });

  it('sorts children by name within a group', () => {
    const groups = packingList([
      line({ recipientName: 'Zara' }),
      line({ recipientName: 'Aarav' }),
    ]);
    expect(groups[0]?.entries.map((e) => e.recipientName)).toEqual(['Aarav', 'Zara']);
  });

  it('handles a school with no breaks', () => {
    const groups = packingList([line({ breakId: null, breakLabel: null })]);
    expect(groups[0]?.breakLabel).toBeNull();
    expect(groups[0]?.entries).toHaveLength(1);
  });

  it('does not collide groups whose labels contain the separator', () => {
    // Keys are JSON-encoded rather than joined, so a class literally named "5|A" cannot
    // land in the same group as class "5", section "A".
    const groups = packingList([
      line({ classLabel: '5|A', sectionLabel: null }),
      line({ classLabel: '5', sectionLabel: 'A' }),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('CSV (E09-11a)', () => {
  it('produces a header and a row per dish', () => {
    expect(productionCsv([line({ quantity: 2 })])).toBe(
      '"Dish","Quantity"\r\n"Veg Sandwich","2"',
    );
  });

  it('uses CRLF, because the target is Excel on whatever laptop is in the office', () => {
    expect(productionCsv([line()])).toContain('\r\n');
  });

  it('escapes quotes rather than breaking the row', () => {
    const out = productionCsv([line({ dishName: 'The "Big" One' })]);
    expect(out).toContain('"The ""Big"" One"');
  });

  it('neutralises a value Excel would treat as a formula', () => {
    // A dish named "-- Special" is a calculation in Excel; a crafted one is a command.
    // The leading apostrophe is the documented mitigation and is invisible in the cell.
    const out = productionCsv([line({ dishName: '=cmd|calc' })]);
    expect(out).toContain(`"'=cmd|calc"`);
  });

  it('keeps children out of the production list entirely', () => {
    // This is the file that gets printed and left on a counter.
    const out = productionCsv([line({ recipientName: 'Aarav' })]);
    expect(out).not.toContain('Aarav');
  });

  it('keeps children out of the per-school list too', () => {
    const out = perSchoolCsv([line({ recipientName: 'Aarav' })]);
    expect(out).not.toContain('Aarav');
    expect(out).toContain('Alpha Public School');
  });

  it('warns, in the file, that the packing list names children', () => {
    // A CSV outlives the conversation that produced it. Whoever finds it on a shared drive
    // in six months did not attend that conversation.
    const out = packingCsv([line()]);
    expect(out.split('\r\n')[0]).toMatch(/CHILDREN/i);
    expect(out).toContain('Aarav');
  });
});

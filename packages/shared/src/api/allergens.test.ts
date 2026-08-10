import { describe, expect, it, afterEach, vi } from 'vitest';

import { ALLERGEN_COLUMNS, AllergenPayloadError, fetchAllergens, setApiTransport } from './index.js';

/** A select builder that records what was asked for and answers with fixed rows. */
function stub(rows: unknown) {
  const select = vi.fn();
  const order = vi.fn();
  const builder = {
    select: (columns: string) => {
      select(columns);
      return builder;
    },
    order: (column: string) => {
      order(column);
      return builder;
    },
    then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  setApiTransport({
    from: () => builder,
    functions: {
      invoke: () => {
        throw new Error('a read must not invoke a function');
      },
    },
  } as never);
  return { select, order };
}

const ROWS = [
  { id: 'a1', code: 'milk', display_name: 'Milk', is_major: true },
  { id: 'a2', code: 'soy', display_name: 'Soy', is_major: false },
];

afterEach(() => setApiTransport(null));

describe('fetchAllergens', () => {
  it('names its columns rather than globbing', async () => {
    // Same reason `SCHOOL_COLUMNS` is spelled out: a policy filters rows, never columns, so
    // the column list is the only redaction there is. `allergen` is not sensitive today —
    // the discipline is, because the next table this pattern is copied onto might be.
    const { select } = stub(ROWS);
    await fetchAllergens();
    expect(select).toHaveBeenCalledWith(ALLERGEN_COLUMNS);
    expect(ALLERGEN_COLUMNS).not.toContain('*');
  });

  it('orders by sort_order, not alphabetically', async () => {
    // The list is scanned by someone looking for their child's allergen. `sort_order` is
    // where the judgement about what to show first lives, in data.
    const { order } = stub(ROWS);
    await fetchAllergens();
    expect(order).toHaveBeenCalledWith('sort_order');
  });

  it('maps the rows onto the shape the screen uses', async () => {
    stub(ROWS);
    await expect(fetchAllergens()).resolves.toEqual([
      { id: 'a1', code: 'milk', displayName: 'Milk', isMajor: true },
      { id: 'a2', code: 'soy', displayName: 'Soy', isMajor: false },
    ]);
  });

  it('is empty rather than broken when nothing is configured', async () => {
    stub([]);
    await expect(fetchAllergens()).resolves.toEqual([]);
  });

  it('refuses a row with no id or display name', async () => {
    // An allergen with no name cannot be ticked, and one with no id cannot be matched
    // against a dish — so a half-row is worse than no row and must not reach the screen.
    stub([{ code: 'milk' }]);
    await expect(fetchAllergens()).rejects.toBeInstanceOf(AllergenPayloadError);
  });
});

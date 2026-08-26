import { describe, expect, it } from 'vitest';

import {
  COPIED_ITEM_FIELDS,
  MENU_NAME_MAX,
  copyName,
  normaliseMenuName,
  validateMenuCreate,
  validateMenuDuplicate,
  validateMenuName,
} from './menu-write.js';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('normaliseMenuName', () => {
  it('trims, because a trailing space is a typo rather than a decision', () => {
    expect(normaliseMenuName('  Term 1  ')).toBe('Term 1');
  });

  it('collapses runs of whitespace, which are invisible on screen', () => {
    // "Term 1" and "Term  1" would sit next to each other in the dropdown forever, and nobody
    // would be able to see which was which.
    expect(normaliseMenuName('Term  1\t2026')).toBe('Term 1 2026');
  });

  it('is empty for anything that is not a string', () => {
    expect(normaliseMenuName(undefined)).toBe('');
    expect(normaliseMenuName(42)).toBe('');
  });
});

describe('validateMenuName', () => {
  it('accepts an ordinary name', () => {
    expect(validateMenuName('Term 1 2026')).toBeNull();
  });

  it('refuses a name that is only whitespace', () => {
    expect(validateMenuName('   ')).toEqual({ name: 'Give the menu a name.' });
  });

  it('refuses one over the limit but accepts one exactly at it', () => {
    expect(validateMenuName('x'.repeat(MENU_NAME_MAX))).toBeNull();
    expect(validateMenuName('x'.repeat(MENU_NAME_MAX + 1))).not.toBeNull();
  });
});

describe('validateMenuCreate', () => {
  it('accepts a name and a kitchen', () => {
    expect(validateMenuCreate({ name: 'Term 2', kitchenId: UUID })).toBeNull();
  });

  it('names every missing field at once rather than one at a time', () => {
    // Being told about the second problem only after fixing the first is the worst form a
    // validation error takes.
    const errors = validateMenuCreate({ name: '', kitchenId: 'not-a-uuid' })!;
    expect(Object.keys(errors).sort()).toEqual(['kitchenId', 'name']);
  });

  it('refuses a kitchen id that is not a uuid', () => {
    expect(validateMenuCreate({ name: 'Term 2', kitchenId: '1' })).toHaveProperty('kitchenId');
  });
});

describe('validateMenuDuplicate', () => {
  it('accepts a source menu and a new name', () => {
    expect(validateMenuDuplicate({ menuId: UUID, name: 'Term 1 (copy)' })).toBeNull();
  });

  it('refuses a duplicate with no source', () => {
    expect(validateMenuDuplicate({ name: 'Copy' })).toHaveProperty('menuId');
  });
});

describe('copyName', () => {
  it('suggests "(copy)" when nothing is in the way', () => {
    expect(copyName('Term 1 2026', [])).toBe('Term 1 2026 (copy)');
  });

  it('counts up rather than refusing, because duplicating twice is reasonable', () => {
    expect(copyName('Term 1', ['Term 1 (copy)'])).toBe('Term 1 (copy 2)');
    expect(copyName('Term 1', ['Term 1 (copy)', 'Term 1 (copy 2)'])).toBe('Term 1 (copy 3)');
  });

  it('compares against normalised names, so stray spacing does not fool it', () => {
    expect(copyName('Term 1', ['  Term 1   (copy) '])).toBe('Term 1 (copy 2)');
  });

  it('stays within the length limit even when the source is already at it', () => {
    // Truncating the base rather than overflowing: the column has no length constraint, but a
    // name nobody can read in a dropdown is its own kind of broken.
    const long = 'x'.repeat(MENU_NAME_MAX);
    const copy = copyName(long, []);
    expect(copy.length).toBeLessThanOrEqual(MENU_NAME_MAX);
    expect(copy.endsWith(' (copy)')).toBe(true);
  });
});

describe('COPIED_ITEM_FIELDS', () => {
  /*
   * The rule this whole module exists for. A duplicate that inherited its source's school
   * assignments would put a second live menu in front of a school already being fed, and
   * `create_checkout` resolves a school's menu through `menu_assignment` — two live rows for one
   * school is an order path picking one of them silently.
   */
  it('copies no identity, no parent and no timestamps', () => {
    for (const forbidden of ['id', 'menu_id', 'created_at', 'updated_at']) {
      expect(COPIED_ITEM_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('copies nothing about a school or an assignment', () => {
    for (const forbidden of ['school_id', 'valid_from', 'valid_to', 'revoked_at']) {
      expect(COPIED_ITEM_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('copies the price, which is the whole point of duplicating', () => {
    expect(COPIED_ITEM_FIELDS as readonly string[]).toContain('price_paise');
    expect(COPIED_ITEM_FIELDS as readonly string[]).toContain('dish_id');
    expect(COPIED_ITEM_FIELDS as readonly string[]).toContain('available_days');
  });

  it('sends no status, so the column default decides and only 0001 defines it', () => {
    // `menu.status` is `not null default 'draft'`. Restating 'draft' here would be a second
    // place to disagree with the schema.
    expect(COPIED_ITEM_FIELDS as readonly string[]).not.toContain('status');
  });
});

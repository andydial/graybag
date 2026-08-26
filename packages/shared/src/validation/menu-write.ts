/**
 * Creating and duplicating a menu — `E10-50`.
 *
 * The rules live here rather than in the Edge Function so the browser can refuse a bad name
 * without a round trip and the server can refuse the same one for real. One definition, two
 * callers; a client-side copy of a server rule is a client-side copy that drifts.
 *
 * ## The rule that matters is what a duplicate does NOT copy
 *
 * A duplicate copies the **items and their prices**. It must never copy the source menu's
 * **school assignments**, and that is not a tidiness preference:
 *
 * > Duplicating "Term 1, serving Amity from January" and inheriting its assignment would put a
 * > second live menu in front of a school that is already being fed. `create_checkout` resolves a
 * > school's menu through `menu_assignment`, so two live rows for one school is an order path
 * > picking one of them — silently, and not necessarily the one anybody intended.
 *
 * Nothing here writes an assignment. That is a question about a *school*, answered on the schools
 * screen, where the date window is visible and deliberate.
 *
 * ## A new menu is a draft, and the schema already said so
 *
 * `menu.status` is `menu_status not null default 'draft'` in `0001`. I had this down as a question
 * for Andy — the prototype shows a draft badge and nothing set one — and the answer was already in
 * the schema. Neither path here sends a status, so both inherit the default rather than restating
 * it: a literal `'draft'` in two more places is two more places to disagree with the column.
 */

/** Long enough to be descriptive, short enough for a chip on a school row. */
export const MENU_NAME_MAX = 80;

export interface MenuWriteErrors {
  [field: string]: string;
}

/**
 * A name a person will have to recognise in a dropdown a year from now.
 *
 * Trimmed rather than rejected for surrounding space — a trailing space is a typo, not a decision,
 * and refusing it teaches nothing. Collapsing runs of whitespace matters more than it looks:
 * "Term 1" and "Term  1" are indistinguishable on screen and would sit next to each other in the
 * list forever.
 */
export function normaliseMenuName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
}

export function validateMenuName(raw: unknown): MenuWriteErrors | null {
  const name = normaliseMenuName(raw);
  if (name === '') return { name: 'Give the menu a name.' };
  if (name.length > MENU_NAME_MAX) {
    return { name: `Keep the name to ${MENU_NAME_MAX} characters or fewer.` };
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MenuCreate {
  name: string;
  kitchenId: string;
}

export function validateMenuCreate(input: {
  name?: unknown; kitchenId?: unknown;
}): MenuWriteErrors | null {
  const errors: MenuWriteErrors = { ...(validateMenuName(input.name) ?? {}) };
  if (typeof input.kitchenId !== 'string' || !UUID.test(input.kitchenId)) {
    errors.kitchenId = 'Choose which kitchen this menu belongs to.';
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export interface MenuDuplicate {
  menuId: string;
  name: string;
}

export function validateMenuDuplicate(input: {
  menuId?: unknown; name?: unknown;
}): MenuWriteErrors | null {
  const errors: MenuWriteErrors = { ...(validateMenuName(input.name) ?? {}) };
  if (typeof input.menuId !== 'string' || !UUID.test(input.menuId)) {
    errors.menuId = 'Say which menu to copy.';
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * A default name for a copy, so the dialog opens with something sensible in it.
 *
 * "Term 1 2026 (copy)", then "(copy 2)" — rather than refusing, because somebody duplicating twice
 * in a row is doing something reasonable and being told "that name is taken" is not help. Kept
 * inside the length limit even when the source name is already at it.
 */
export function copyName(source: string, existing: readonly string[]): string {
  const base = normaliseMenuName(source);
  const taken = new Set(existing.map(normaliseMenuName));

  const fit = (suffix: string) =>
    `${base.slice(0, Math.max(0, MENU_NAME_MAX - suffix.length))}${suffix}`;

  const first = fit(' (copy)');
  if (!taken.has(first)) return first;

  for (let n = 2; n < 100; n += 1) {
    const next = fit(` (copy ${n})`);
    if (!taken.has(next)) return next;
  }
  // Ninety-nine copies of one menu is not a case worth designing for; hand back the plain one and
  // let the person edit it rather than inventing a hundredth suffix.
  return first;
}

/**
 * The fields of a source item that a copy inherits.
 *
 * Written as an explicit list rather than a spread of the source row, because a spread copies
 * whatever gets added to `menu_item` next — including an id, a `menu_id` and timestamps, and
 * including any future column whose correct behaviour on a copy nobody has thought about yet.
 * A new column should have to be added here on purpose.
 */
export const COPIED_ITEM_FIELDS = [
  'dish_id',
  'price_paise',
  'category_id',
  'available_days',
  'is_active',
  'sort_order',
] as const;

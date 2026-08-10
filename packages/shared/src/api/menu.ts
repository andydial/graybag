/**
 * Menu reads — the two calls `E04-10`'s cache needs, and the first real users of the
 * `api/` module.
 *
 * Both read tables directly under the anon policies added in migration `0012` — Andy's
 * `[AUTH-01]` ruling. The read carries the caller's authority, not a function's, so the
 * database is the boundary rather than a function body.
 *
 * ## One request, not four
 *
 * Drawing the menu from base tables needs the live assignment, the items, the price
 * overrides and the allergens. Four dependent round trips on a cold open, against an
 * audience CLAUDE.md describes as mid-range Androids on unreliable connections, is the
 * difference between a menu that appears and one that is still arriving. `public_menu` is
 * a `security_invoker` view over exactly those joins: it carries no authority of its own —
 * every row has already passed the same policies — and collapses the four into one.
 *
 * ## Why this transforms and the old version did not
 *
 * The view returns one row per dish. `CachedMenuPayload` wants `{ categories, dishes }`,
 * so the grouping happens here. It is the price of the read being a table read: a database
 * function could shape the payload, a policy cannot.
 *
 * The validation is not decoration. A cached menu is written to device storage and read
 * back for days; a malformed payload accepted once becomes a crash on a later cold start,
 * a long way from the fetch that caused it.
 */
import { runQuery } from './client.js';

/** One allergen marking on a dish. Mirrors `dish_allergen`. */
export interface ApiDishAllergen {
  allergenId: string;
  presence: 'contains' | 'may_contain';
}

export interface ApiDish {
  id: string;
  /**
   * The `menu_item` row this dish is being offered as — **not** the dish id.
   *
   * `create_checkout` identifies a line by this and nothing else, because a dish is the
   * food while a `menu_item` is that dish *on a particular menu at a price*: the same dish
   * appears on several menus and `menu_item_price_override` is keyed on the item and the
   * school. Ordering by dish id would mean the server picking an item on the client's
   * behalf, and "which price did the customer actually see" would have no answer.
   *
   * `public_menu` did not expose it until migration `0017`, which meant there was no
   * sequence of calls the app could make that produced a valid order line (`E05-16`).
   */
  menuItemId: string;
  name: string;
  description: string | null;
  categoryId: string;
  ingredientsText: string | null;
  pricePaise: number;
  imageUri: string | null;
  allergens: ApiDishAllergen[];
  allergensDeclaredNone: boolean;
}

export interface ApiMenuPayload {
  categories: { id: string; label: string }[];
  dishes: ApiDish[];
}

/** Raised when the backend returns a payload that is not the agreed shape. */
export class MenuPayloadError extends Error {
  constructor(detail: string) {
    super(`The menu payload is not usable: ${detail}`);
    this.name = 'MenuPayloadError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function assertDish(value: unknown, index: number): ApiDish {
  if (!isRecord(value)) throw new MenuPayloadError(`dish ${index} is not an object`);

  const { id, menuItemId, name, categoryId, pricePaise } = value;
  if (typeof id !== 'string') throw new MenuPayloadError(`dish ${index} has no id`);
  // Refused rather than defaulted. A dish with no `menuItemId` cannot be ordered — the
  // checkout identifies a line by it — so a payload missing it is a menu that looks
  // browsable and is not, which is the failure `E05-16` was made of.
  if (typeof menuItemId !== 'string') {
    throw new MenuPayloadError(`dish ${id} has no menuItemId`);
  }
  if (typeof name !== 'string') throw new MenuPayloadError(`dish ${id} has no name`);
  if (typeof categoryId !== 'string') throw new MenuPayloadError(`dish ${id} has no categoryId`);

  // Money is integer paise everywhere (non-negotiable #3). A float here would round
  // somewhere downstream and the difference would show up on an invoice, so it is refused
  // at the boundary rather than coerced.
  if (typeof pricePaise !== 'number' || !Number.isInteger(pricePaise) || pricePaise < 0) {
    throw new MenuPayloadError(
      `dish ${id} has pricePaise ${String(pricePaise)}, which is not a non-negative integer`,
    );
  }

  const rawAllergens = Array.isArray(value.allergens) ? value.allergens : [];
  const allergens: ApiDishAllergen[] = rawAllergens.map((a, i) => {
    if (!isRecord(a) || typeof a.allergenId !== 'string') {
      throw new MenuPayloadError(`dish ${id} allergen ${i} has no allergenId`);
    }
    // An unknown presence is treated as the more cautious of the two rather than dropped.
    // Under-warning about an allergen is the one failure in this payload that can hurt a
    // child, so the default leans towards warning (E05-05, D7).
    const presence = a.presence === 'may_contain' ? 'may_contain' : 'contains';
    return { allergenId: a.allergenId, presence };
  });

  return {
    id,
    menuItemId,
    name,
    description: typeof value.description === 'string' ? value.description : null,
    categoryId,
    ingredientsText: typeof value.ingredientsText === 'string' ? value.ingredientsText : null,
    pricePaise,
    imageUri: typeof value.imageUri === 'string' ? value.imageUri : null,
    allergens,
    allergensDeclaredNone: value.allergensDeclaredNone === true,
  };
}


/**
 * The school's current menu version, or `null` when the school has no menu yet.
 *
 * `null` is a real answer, not an error: a school that has never been given a menu shows an
 * empty Menu tab, and `AR7` is explicit that a missing school must not be a wall in front of
 * browsing. One primary-key lookup by design — it runs on every app open.
 */
export async function fetchMenuVersion(schoolId: string): Promise<number | null> {
  const rows = await runQuery<{ version: number | string }>((t) =>
    t.from('school_menu_version').select('version').eq('school_id', schoolId),
  );
  const first = rows[0];
  if (first === undefined || first.version === null) return null;

  // Postgres `bigint` arrives as a string over PostgREST once it exceeds 2^53. The version
  // is monotonic and will not get there, but parsing rather than casting means the day it
  // does is not the day cache invalidation starts silently succeeding.
  const asNumber =
    typeof first.version === 'string' ? Number.parseInt(first.version, 10) : first.version;
  if (!Number.isFinite(asNumber)) {
    throw new MenuPayloadError(`menu version ${String(first.version)} is not a number`);
  }
  return asNumber;
}

/** One row of `public_menu`. */
interface MenuRow {
  dish_id: unknown;
  menu_item_id: unknown;
  name: unknown;
  description: unknown;
  ingredients_text: unknown;
  allergens_declared_none: unknown;
  category_id: unknown;
  category_label: unknown;
  price_paise: unknown;
  image_path: unknown;
  allergens: unknown;
}

/**
 * The school's live menu, validated and grouped.
 *
 * Empty rather than absent when there is no menu — and note that an empty result is also
 * what a *policy* denial looks like, which is why `runQuery` refuses to collapse an error
 * into an empty list.
 */
export async function fetchMenu(schoolId: string): Promise<ApiMenuPayload> {
  const rows = await runQuery<MenuRow>((t) =>
    t.from('public_menu').select('*').eq('school_id', schoolId).order('sort_order'),
  );

  const categories = new Map<string, string>();
  const dishes = rows.map((row, i) => {
    const dish = assertDish(
      {
        id: row.dish_id,
        menuItemId: row.menu_item_id,
        name: row.name,
        description: row.description,
        categoryId: row.category_id,
        ingredientsText: row.ingredients_text,
        pricePaise: row.price_paise,
        imageUri: row.image_path,
        allergensDeclaredNone: row.allergens_declared_none,
        allergens: row.allergens,
      },
      i,
    );
    // First label wins. The view derives it from one join, so two rows disagreeing about a
    // category's name would mean the database disagrees with itself.
    if (typeof row.category_label === 'string' && !categories.has(dish.categoryId)) {
      categories.set(dish.categoryId, row.category_label);
    }
    return dish;
  });

  return {
    categories: [...categories].map(([id, label]) => ({ id, label })),
    dishes,
  };
}

/**
 * Menu reads — the two calls `E04-10`'s cache needs, and the first real users of the
 * `api/` module.
 *
 * Both go through the `[AUTH-01]` functions added in migration `0010`, which is what makes
 * the Menu tab work for a signed-out user. See that migration's header for why the read is
 * a `SECURITY DEFINER` function rather than a table grant, and what Andy decided.
 *
 * ## Why these return the cache's shape and not the database's
 *
 * `get_school_menu` already returns `{ categories, dishes }` in exactly the shape
 * `CachedMenuPayload` declares, so this module validates rather than transforms. That is
 * deliberate: a transform here would be a second place where the payload shape is written
 * down, and `MC2`'s rule — store the version that arrived *with* the body — depends on the
 * body being exactly what was fetched.
 *
 * The validation is not decoration. A cached menu is written to device storage and read
 * back for days; a malformed payload accepted once becomes a crash on a later cold start,
 * a long way from the fetch that caused it.
 */
import { callRpc } from './client.js';

/** One allergen marking on a dish. Mirrors `dish_allergen`. */
export interface ApiDishAllergen {
  allergenId: string;
  presence: 'contains' | 'may_contain';
}

export interface ApiDish {
  id: string;
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

  const { id, name, categoryId, pricePaise } = value;
  if (typeof id !== 'string') throw new MenuPayloadError(`dish ${index} has no id`);
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

function assertPayload(value: unknown): ApiMenuPayload {
  if (!isRecord(value)) throw new MenuPayloadError('the response is not an object');

  const rawCategories = Array.isArray(value.categories) ? value.categories : [];
  const categories = rawCategories.map((c, i) => {
    if (!isRecord(c) || typeof c.id !== 'string' || typeof c.label !== 'string') {
      throw new MenuPayloadError(`category ${i} has no id or label`);
    }
    return { id: c.id, label: c.label };
  });

  const rawDishes = Array.isArray(value.dishes) ? value.dishes : [];
  return { categories, dishes: rawDishes.map(assertDish) };
}

/**
 * The school's current menu version, or `null` when the school has no menu yet.
 *
 * `null` is a real answer, not an error: a school that has never been given a menu shows an
 * empty Menu tab, and `AR7` is explicit that a missing school must not be a wall in front of
 * browsing. Called on every app open, so it is one primary-key lookup by design.
 */
export async function fetchMenuVersion(schoolId: string): Promise<number | null> {
  const version = await callRpc<number | string | null>('get_school_menu_version', {
    p_school_id: schoolId,
  });
  if (version === null || version === undefined) return null;

  // Postgres `bigint` arrives as a string over PostgREST once it exceeds 2^53. The version
  // is monotonic and will not get there, but parsing rather than casting means the day it
  // does is not the day comparisons start silently succeeding.
  const asNumber = typeof version === 'string' ? Number.parseInt(version, 10) : version;
  if (!Number.isFinite(asNumber)) {
    throw new MenuPayloadError(`menu version ${String(version)} is not a number`);
  }
  return asNumber;
}

/** The school's live menu, validated. Empty rather than absent when there is no menu. */
export async function fetchMenu(schoolId: string): Promise<ApiMenuPayload> {
  const payload = await callRpc<unknown>('get_school_menu', { p_school_id: schoolId });
  if (payload === null || payload === undefined) return { categories: [], dishes: [] };
  return assertPayload(payload);
}

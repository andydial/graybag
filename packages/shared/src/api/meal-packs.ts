/**
 * Meal packs, from the parent's side. `E21-32`.
 *
 * Three surfaces: **buying** a pack, the **balance**, and **spending** it. This module answers
 * only the reads; every write — buying, confirming a plan, redeeming in the cart — goes through an
 * Edge Function (`A4`, non-negotiable #1), because each of them moves money or a balance.
 *
 * ## The surface question is asked once, of the server
 *
 * Andy, 2026-08-26: *"No pack surface renders in the parent app unless configuration says so. Not
 * a hidden tab, not an empty state, not a menu entry — if no offer is live for that school, the
 * parent sees an app with no such concept."*
 *
 * So the app never assembles that rule from parts. `fetchMealPackSurface` returns the whole
 * answer, and there are three cases:
 *
 *   1. **Neither** — no concept. Nothing renders, nothing navigates, no banner, no empty state.
 *   2. **`canBuy`** — the offers surface is reachable and may be advertised.
 *   3. **`hasBalance`** — the balance, planner and cart toggle are reachable **whatever `canBuy`
 *      says.** This is the case that survives a school being switched off: withdrawing an offer
 *      stops selling, and must never strand meals somebody has already paid for.
 *
 * `hasBalance` is a debt owed to this parent. `canBuy` is a business decision. Conflating them is
 * the bug (`E21-31`).
 */
import { ApiError, runRpc } from './client.js';

/** What a parent may see, at this school, right now. */
export interface MealPackSurface {
  /** Configuration says packs are sold here. Gates the offers screen and any prompt toward it. */
  canBuy: boolean;
  /** This parent holds spendable meals. Gates the balance, the planner and the cart toggle. */
  hasBalance: boolean;
}

/** An offer as a parent sees it. Prices are GST-exclusive, like every menu price. */
export interface MealPackOffer {
  id: string;
  name: string;
  mealsCount: number;
  itemsPerMeal: number;
  requiredCategoryId: string;
  netPricePaise: number;
  /** What the same meals cost singly. Display only — never used in a money calculation. */
  alacarteReferencePaise: number;
  validityDays: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asInt = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new ApiError(`Meal pack ${field} is not an integer.`);
  }
  return v;
};

/**
 * What pack surface, if any, exists for this parent at this school.
 *
 * **Defaults to nothing on any failure**, and that is deliberate rather than defensive habit. The
 * two mistakes are not symmetric: rendering nothing when packs are available costs a sale the
 * parent can still make next time they open the app, while rendering a pack surface that should
 * not exist offers to take money for something we do not sell there. When the answer is unknown,
 * the safe answer is no.
 *
 * This is the one place in this module that swallows an error, and it is the one place where the
 * failure mode is worse than the silence.
 */
export async function fetchMealPackSurface(
  userId: string,
  schoolId: string,
): Promise<MealPackSurface> {
  try {
    const rows = await runRpc<unknown>('meal_pack_surface', {
      p_user_id: userId,
      p_school_id: schoolId,
    });
    // A `returns table` RPC comes back as an array of one row.
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!isRecord(row)) return { canBuy: false, hasBalance: false };
    return {
      canBuy: row.can_buy === true,
      hasBalance: row.has_balance === true,
    };
  } catch {
    return { canBuy: false, hasBalance: false };
  }
}

/**
 * The offers a parent may buy at this school.
 *
 * Goes through `meal_pack_offers_for_school`, a `security definer` function, because there is
 * deliberately **no policy on `meal_pack_offer` facing a parent at all** (`E21-27`). The
 * distinction is worth keeping in mind when reading this: with a table policy the app decides what
 * to ask for and the database checks it is allowed; here the database decides what exists for that
 * school, and there is no query this module could write to see more.
 *
 * Throws on failure rather than returning `[]`, unlike `fetchMealPackSurface` above: by the time
 * this is called the parent is looking at a screen that promised offers, and an empty list would
 * read as "there are none" when the truth is "we could not ask".
 */
export async function fetchMealPackOffers(schoolId: string): Promise<MealPackOffer[]> {
  const rows = await runRpc<unknown>('meal_pack_offers_for_school', { p_school_id: schoolId });
  if (!Array.isArray(rows)) {
    throw new ApiError('The meal pack offers response was not a list.');
  }
  return rows.map((row) => {
    if (!isRecord(row)) throw new ApiError('A meal pack offer was not an object.');
    if (typeof row.id !== 'string' || typeof row.name !== 'string') {
      throw new ApiError('A meal pack offer is missing its id or name.');
    }
    if (typeof row.required_category_id !== 'string') {
      throw new ApiError('A meal pack offer is missing its required category.');
    }
    return {
      id: row.id,
      name: row.name,
      mealsCount: asInt(row.meals_count, 'meals_count'),
      itemsPerMeal: asInt(row.items_per_meal, 'items_per_meal'),
      requiredCategoryId: row.required_category_id,
      netPricePaise: asInt(row.net_price_paise, 'net_price_paise'),
      alacarteReferencePaise: asInt(row.alacarte_reference_paise, 'alacarte_reference_paise'),
      validityDays: asInt(row.validity_days, 'validity_days'),
    };
  });
}

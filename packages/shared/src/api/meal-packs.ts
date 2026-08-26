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
import { ApiError, invokeFunction, runRpc } from './client.js';

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

/** A parent's balance, as the balance screen and the cart strip need it. */
export interface MealPackBalance {
  mealPackId: string;
  packName: string;
  mealsTotal: number;
  mealsRemaining: number;
  purchasedAt: string;
  expiresAt: string;
  expired: boolean;
  /** Across every live pack, for a surface that wants the total rather than the next one. */
  mealsAcrossAllPacks: number;
  /** The offer's meal rule, so the app can explain a refusal before the parent taps. */
  itemsPerMeal: number;
  requiredCategoryId: string;
}

/**
 * The balance a parent holds, or `null` when they hold none.
 *
 * Returns **the pack the next order will draw from** — oldest-expiring and spendable first,
 * matching `spend_meal_pack_meals` — rather than a sum. A summed total across packs with different
 * expiry dates is true and useless: it cannot answer *when do I lose these*.
 *
 * `null` is a real answer here and not a failure: it means no pack. A failure THROWS, because a
 * cart strip that renders "no meals left" to a parent holding seven is worse than one that
 * renders nothing — the first is a lie about money, the second is a gap.
 */
export async function fetchMealPackBalance(userId: string): Promise<MealPackBalance | null> {
  const rows = await runRpc<unknown>('meal_pack_balance', { p_user_id: userId });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (row === undefined || row === null) return null;
  if (!isRecord(row)) throw new ApiError('The meal pack balance was not an object.');
  if (typeof row.meal_pack_id !== 'string' || typeof row.pack_name !== 'string') {
    throw new ApiError('The meal pack balance is missing its id or name.');
  }
  if (typeof row.purchased_at !== 'string' || typeof row.expires_at !== 'string') {
    throw new ApiError('The meal pack balance is missing its dates.');
  }
  return {
    mealPackId: row.meal_pack_id,
    packName: row.pack_name,
    mealsTotal: asInt(row.meals_total, 'meals_total'),
    mealsRemaining: asInt(row.meals_remaining, 'meals_remaining'),
    purchasedAt: row.purchased_at,
    expiresAt: row.expires_at,
    expired: row.expired === true,
    mealsAcrossAllPacks: asInt(row.meals_across_all_packs, 'meals_across_all_packs'),
    itemsPerMeal: asInt(row.items_per_meal, 'items_per_meal'),
    requiredCategoryId:
      typeof row.required_category_id === 'string' ? row.required_category_id : '',
  };
}

/** One day of a plan, as the server expects it. */
export interface PlanDayInput {
  serviceDate: string;
  recipientId: string;
  lines: readonly { dishId: string; quantity: number }[];
}

export interface ConfirmedPlan {
  orderIds: string[];
  redemptionIds: string[];
  /** True when this was a retry the server recognised and did not act on again. */
  replayed: boolean;
}

/**
 * Confirm a plan and spend its meals. `E21-47`.
 *
 * **A write, so it goes through an Edge Function** (`A4`, non-negotiable #1) — it spends a balance
 * and posts to the ledger, and the caller's identity is proved from their JWT before any of that
 * happens.
 *
 * ## The key is the caller's to keep
 *
 * `idempotencyKey` must be the SAME string across a retry of the same plan, which is the whole
 * mechanism: a parent at the school gate taps Confirm, the response is lost, they tap again, and
 * four days must produce four orders rather than eight. A key generated inside this function
 * would differ per attempt and defeat it, so it is a required argument rather than a default.
 *
 * `replayed: true` means the server recognised the retry and wrote nothing. That is a **success**,
 * not a warning — the orders in the result are the ones the first attempt created.
 */
export async function confirmMealPackPlan(input: {
  idempotencyKey: string;
  days: readonly PlanDayInput[];
}): Promise<ConfirmedPlan> {
  if (input.idempotencyKey.trim() === '') {
    throw new ApiError('An idempotency key is required to confirm a plan.');
  }
  const data = await invokeFunction<Record<string, unknown>>('confirm-pack-plan', {
    idempotency_key: input.idempotencyKey,
    days: input.days.map((day) => ({
      service_date: day.serviceDate,
      recipient_id: day.recipientId,
      lines: day.lines.map((line) => ({ dish_id: line.dishId, quantity: line.quantity })),
    })),
  });

  const orderIds = Array.isArray(data.order_ids) ? data.order_ids.map(String) : [];
  const redemptionIds = Array.isArray(data.redemption_ids)
    ? data.redemption_ids.map(String)
    : [];
  return { orderIds, redemptionIds, replayed: data.replayed === true };
}

/** One day the planner can offer, straight from `orderable_calendar`. */
export interface OrderableDay {
  serviceDate: string;
  cutoffAt: string;
  isOrderable: boolean;
  /** Why not, when it is not. `cutoff_passed`, `no_service`, and whatever the server adds. */
  reason: string | null;
}

/**
 * The days a school can be ordered for. `E21-44`.
 *
 * **This is not a new endpoint.** `order-calendar` has existed since `E05` and had **no caller at
 * all** — the planner is its first. Building a second calendar for packs would have meant two
 * implementations of "which days can this school be ordered for", and the one nobody called would
 * have been the one that drifted.
 *
 * `advisory: true` is the server's own word for what this is. The cutoff it reports is a
 * prediction; `confirm_meal_pack_plan` re-checks every day inside the transaction that spends the
 * meals, because a plan built at 23:58 can be confirmed at 00:01.
 */
export async function fetchOrderableDays(input: {
  schoolId: string;
  from: string;
  to: string;
}): Promise<OrderableDay[]> {
  const data = await invokeFunction<Record<string, unknown>>(
    `order-calendar?school=${encodeURIComponent(input.schoolId)}` +
      `&from=${encodeURIComponent(input.from)}&to=${encodeURIComponent(input.to)}`,
    undefined,
    'GET',
  );
  const days = Array.isArray(data.days) ? data.days : [];
  return days.map((row) => {
    if (!isRecord(row)) throw new ApiError('A calendar day was not an object.');
    return {
      serviceDate: String(row.serviceDate ?? ''),
      cutoffAt: String(row.cutoffAt ?? ''),
      isOrderable: row.isOrderable === true,
      reason: typeof row.reason === 'string' ? row.reason : null,
    };
  });
}

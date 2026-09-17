/**
 * Meal packs, from the parent's side. `E21-73`, rebuilt.
 *
 * Replaces the module that served the old design — meals of N items with a required category, a
 * planner, one meal per order. **One item is one item now**, with no price cap and no category
 * exclusion, and the balance is spent in the cart at checkout like any other order.
 *
 * Three surfaces: **buying** a pack, the **balance**, and what the **cart** shows. This module
 * answers only the reads; every write — buying, redeeming, cancelling — goes through an Edge
 * Function (`A4`, non-negotiable #1), because each of them moves money or a balance.
 *
 * ## The surface question is asked once, of the server
 *
 * Andy, 2026-08-26: *"No pack surface renders in the parent app unless configuration says so."*
 * So the app never assembles that rule from parts. `fetchMealPackSurface` returns the whole
 * answer, and the two halves are deliberately not derived from each other:
 *
 *   * **`canBuy`** is a business decision — is an active offer enabled for this school.
 *   * **`hasBalance`** is a **debt** — meals this parent has already paid for.
 *
 * Withdrawing an offer must stop the first and must never touch the second (`E21-31`). A parent
 * whose school stops selling keeps every screen that spends what they own.
 *
 * ## Nothing here knows which child ate
 *
 * There is no recipient on a pack, on a balance or on a redemption — not hidden, absent. Which
 * child a meal was for is a property of the order (non-negotiable #4). Every type below can be
 * logged in full without thinking about it, which is the point of designing it that way rather
 * than remembering to strip it.
 */
import { ApiError, invokeFunction, runRpc } from './client.js';

/** What a parent may see, at this school, right now. */
export interface MealPackSurface {
  /** Configuration says packs are sold here. Gates the offers on Home and the pack screens. */
  canBuy: boolean;
  /** This parent holds spendable items. Gates the balance screen and the cart strip. */
  hasBalance: boolean;
}

/** An offer as a parent sees it. `netPricePaise` is GST-exclusive, like every menu price. */
export interface MealPackOffer {
  id: string;
  name: string;
  /** Ex-tax. 5% is added at checkout — ₹3,000 becomes ₹3,150. */
  netPricePaise: number;
  itemsCount: number;
  /** May be 0, in which case there is no bonus and `bonusWindowDays` is 0 too. */
  bonusItemsCount: number;
  bonusWindowDays: number;
  validityDays: number;
}

/** A pack this parent holds. No recipient, by construction. */
export interface MealPackBalance {
  id: string;
  schoolId: string;
  /** Named on every pack, because a parent with children at two schools holds two balances. */
  schoolName: string;
  /** Snapshotted at sale (`E21-67`), so renaming an offer cannot retitle a pack already held. */
  name: string;
  /** Original items plus the bonus, once the bonus is earned. */
  itemsTotal: number;
  itemsRemaining: number;
  /** Held by a checkout awaiting payment. Spendable is `itemsRemaining - itemsReserved`. */
  itemsReserved: number;
  bonusItems: number;
  bonusRemaining: number;
  bonusGranted: boolean;
  /**
   * Still earnable. The three-way answer — earned / still possible / window closed — is computed
   * SERVER-SIDE from `bonusGranted` and this flag, so two screens cannot disagree about it.
   */
  bonusStillPossible: boolean;
  bonusWindowEndsAt: string;
  purchasedAt: string;
  expiresAt: string;
  status: 'pending' | 'active' | 'exhausted' | 'expired';
  pricePaidPaise: number;
  cgstPaise: number;
  sgstPaise: number;
}

/** What the app gets back when it starts a purchase. Payment follows, then the webhook. */
export interface StartedPurchase {
  orderGroupId: string;
  /** GST-inclusive. This is what Razorpay is asked for. */
  payablePaise: number;
  netPricePaise: number;
  cgstPaise: number;
  sgstPaise: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asInt = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new ApiError(`Meal pack ${field} is not an integer.`);
  }
  return v;
};

const asText = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || v.length === 0) {
    throw new ApiError(`Meal pack ${field} is missing.`);
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
 * It is also what lets the migrations ship ahead of the OTA: a phone on the old bundle calling
 * the old RPC either gets a truthful "no packs" or catches here, and shows an app with no such
 * concept either way.
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
 * deliberately **no policy on `meal_pack_offer` facing a parent at all**. The distinction is worth
 * keeping in mind: with a table policy the app decides what to ask for and the database checks it
 * is allowed; here the database decides what exists for that school, and there is no query this
 * module could write to see more.
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
    return {
      id: asText(row.id, 'id'),
      name: asText(row.name, 'name'),
      netPricePaise: asInt(row.net_price_paise, 'net_price_paise'),
      itemsCount: asInt(row.items_count, 'items_count'),
      bonusItemsCount: asInt(row.bonus_items_count, 'bonus_items_count'),
      bonusWindowDays: asInt(row.bonus_window_days, 'bonus_window_days'),
      validityDays: asInt(row.validity_days, 'validity_days'),
    };
  });
}

const PACK_STATUSES = new Set(['pending', 'active', 'exhausted', 'expired']);

/**
 * Every pack this parent holds, **in spend order** — earliest expiry first.
 *
 * The order is the server's and is the same rule the redemption uses, so the cart strip naming
 * "the pack this order draws from" and the balance screen listing them cannot disagree. The app
 * never sorts this list.
 */
export async function fetchMealPackBalances(userId: string): Promise<MealPackBalance[]> {
  const rows = await runRpc<unknown>('meal_pack_balances', { p_user_id: userId });
  if (!Array.isArray(rows)) {
    throw new ApiError('The meal pack balance response was not a list.');
  }
  return rows.map((row) => {
    if (!isRecord(row)) throw new ApiError('A meal pack balance was not an object.');
    const status = asText(row.status, 'status');
    if (!PACK_STATUSES.has(status)) {
      throw new ApiError(`A meal pack has an unknown status: ${status}`);
    }
    return {
      id: asText(row.id, 'id'),
      schoolId: asText(row.school_id, 'school_id'),
      schoolName: asText(row.school_name, 'school_name'),
      name: asText(row.name, 'name'),
      itemsTotal: asInt(row.items_total, 'items_total'),
      itemsRemaining: asInt(row.items_remaining, 'items_remaining'),
      itemsReserved: asInt(row.items_reserved, 'items_reserved'),
      bonusItems: asInt(row.bonus_items, 'bonus_items'),
      bonusRemaining: asInt(row.bonus_remaining, 'bonus_remaining'),
      bonusGranted: row.bonus_granted === true,
      bonusStillPossible: row.bonus_still_possible === true,
      bonusWindowEndsAt: asText(row.bonus_window_ends_at, 'bonus_window_ends_at'),
      purchasedAt: asText(row.purchased_at, 'purchased_at'),
      expiresAt: asText(row.expires_at, 'expires_at'),
      status: status as MealPackBalance['status'],
      pricePaidPaise: asInt(row.price_paid_paise, 'price_paid_paise'),
      cgstPaise: asInt(row.cgst_paise, 'cgst_paise'),
      sgstPaise: asInt(row.sgst_paise, 'sgst_paise'),
    };
  });
}

/**
 * The pack the next order at this school will draw from, or `null`.
 *
 * The FIRST of `fetchMealPackBalances` filtered to that school, never a second query — a separate
 * read is a chance for the cart and the balance screen to name different packs.
 */
export function packThisOrderDrawsFrom(
  balances: readonly MealPackBalance[],
  schoolId: string,
): MealPackBalance | null {
  return (
    balances.find(
      (b) =>
        b.schoolId === schoolId &&
        b.status === 'active' &&
        b.itemsRemaining - b.itemsReserved > 0,
    ) ?? null
  );
}

/**
 * Start buying a pack. Creates the order group and returns what Razorpay must be asked for.
 *
 * **Nothing is spendable yet.** The pack is written `pending` and becomes `active` only when the
 * capture webhook settles the payment, in the same transaction that posts the sale to the ledger —
 * so a pack is never spendable without its ledger entry, and never carries an obligation we have
 * not been paid for.
 */
export async function startMealPackPurchase(input: {
  offerId: string;
  schoolId: string;
  idempotencyKey: string;
}): Promise<StartedPurchase> {
  /**
   * Refused HERE, before the transport, and not left to the Edge Function's own guard.
   *
   * Without a key a retry after a lost response is a second pack and a second charge, and the
   * server cannot invent one — it would differ per attempt and defeat the point. The server does
   * refuse it, but only after a round trip, and a caller that reached this line with a blank key
   * has a bug the network cannot diagnose for it.
   */
  if (input.idempotencyKey.trim() === '') {
    throw new ApiError('An idempotency key is required to buy a pack.');
  }

  /**
   * `invokeFunction(name, BODY, method)` — three positional arguments, and **no options object**.
   *
   * This read `invokeFunction('buy-meal-pack', { method, body, headers })`, which is the shape
   * `supabase.functions.invoke` takes and NOT the shape of this wrapper. The whole options object
   * was therefore sent as the body, so the function received
   * `{"method":…,"body":{…},"headers":{…}}` — 235 bytes of the wrong thing — read `body.offer_id`
   * as `undefined`, and refused every purchase with a 400 nobody could see (`E21-91`).
   *
   * The idempotency key goes in the BODY, not a header: this wrapper cannot set headers, and
   * `buy-meal-pack` already reads `request.headers.get('Idempotency-Key') || body.idempotency_key`
   * for exactly that reason. `createPaymentOrder` next door has always used this convention,
   * which is why ordinary food checkout worked from the same build while this did not.
   */
  const body = await invokeFunction<unknown>(
    'buy-meal-pack',
    {
      offer_id: input.offerId,
      school_id: input.schoolId,
      idempotency_key: input.idempotencyKey,
    },
    'POST',
  );
  if (!isRecord(body)) throw new ApiError('The purchase response was not an object.');
  return {
    orderGroupId: asText(body.order_group_id, 'order_group_id'),
    payablePaise: asInt(body.payable_paise, 'payable_paise'),
    netPricePaise: asInt(body.net_price_paise, 'net_price_paise'),
    cgstPaise: asInt(body.cgst_paise, 'cgst_paise'),
    sgstPaise: asInt(body.sgst_paise, 'sgst_paise'),
  };
}

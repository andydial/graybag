/**
 * Reading and writing meal pack offers, for the back office — `E21`, rebuilt.
 *
 * The parent-facing reads live in `meal-packs.ts` and show only **active** offers at a school that
 * has them switched on. This is the workshop rather than the shop window: every offer including
 * drafts, and the writes.
 *
 * ## What changed in the rebuild, and why this file was rewritten rather than edited
 *
 * The old model sold a **meal** — *N* items, one of which had to come from a configured category.
 * The new one sells **items**: one item is one item, no cap, no category, no exclusion
 * (`docs/meal-packs-rebuild.md` §1). `meals_count`, `items_per_meal`, `required_category_id` and
 * `alacarte_reference_paise` are all gone, and `bonus_items_count` and `bonus_window_days` are new.
 * That is a different product, not a superset, so the mapping is rewritten in one piece.
 *
 * ## This module CONSUMES `admin-pack-offer`; it does not own it
 *
 * Andy, 2026-09-16: *"MOBILE owns `admin-pack-offer`. They're rewriting the schema underneath it,
 * so the function follows the schema. You consume it — you don't edit it."* What the screens need
 * from that function is written down as a requirement in `planning/andy-queue.md`, not patched in.
 *
 * ## Two switches, both deliberate, and now in two places
 *
 * `is_active` on the offer and `is_enabled` on the offer/school pair are separate, and neither
 * implies the other. A screen that collapsed them into one control would be easier to use and would
 * make "live everywhere" the accident the design exists to prevent.
 *
 * They are now edited on **different screens**, which is Andy's ruling of 2026-09-16: whether a
 * school is *ready* to sell packs is a school-readiness property and belongs on `/admin/schools`
 * beside the other readiness gates, which is where he will be when he turns Amity on. `/admin/packs`
 * links there and does not duplicate the control — *"one control, one place"*.
 */
import { invokeFunction, runQuery } from './client.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export interface AdminPackOffer {
  id: string;
  name: string;
  /** Integer paise, GST-exclusive like every price in this system (non-negotiable #3, #7). */
  netPricePaise: number;
  /** What the parent buys. The denominator of every money figure about this pack (`M10`). */
  itemsCount: number;
  /** Free items earned by finishing the purchased ones inside the window. May be 0. */
  bonusItemsCount: number;
  /** Days from purchase in which the bonus can be earned. 0 exactly when `bonusItemsCount` is 0. */
  bonusWindowDays: number;
  validityDays: number;
  isActive: boolean;
  sortOrder: number;
  /** Schools this offer has a row for, and whether that row is switched on. */
  schools: { schoolId: string; schoolName: string; isEnabled: boolean }[];
}

export const ADMIN_PACK_OFFER_COLUMNS =
  'id,name,net_price_paise,items_count,bonus_items_count,bonus_window_days,' +
  'validity_days,is_active,sort_order,' +
  'meal_pack_offer_school(school_id,is_enabled,school:school_id(name))';

/**
 * Every offer, drafts included.
 *
 * A caller without `meal_packs.manage` gets an empty list rather than an error — the same
 * `[AUTH-01]` ambiguity every other admin read has, and the screen says both possibilities rather
 * than picking one.
 */
export async function fetchAdminPackOffers(): Promise<AdminPackOffer[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('meal_pack_offer').select(ADMIN_PACK_OFFER_COLUMNS).order('sort_order'),
  );

  return rows.filter(isRecord).map((row) => {
    const links = Array.isArray(row.meal_pack_offer_school) ? row.meal_pack_offer_school : [];
    return {
      id: str(row.id),
      name: str(row.name),
      netPricePaise: num(row.net_price_paise),
      itemsCount: num(row.items_count),
      bonusItemsCount: num(row.bonus_items_count),
      bonusWindowDays: num(row.bonus_window_days),
      validityDays: num(row.validity_days),
      isActive: row.is_active === true,
      sortOrder: num(row.sort_order),
      schools: links.filter(isRecord).map((link) => ({
        schoolId: str(link.school_id),
        schoolName: isRecord(link.school) ? str(link.school.name) : '',
        isEnabled: link.is_enabled === true,
      })),
    };
  });
}

export interface PackOfferInput {
  name: string;
  netPricePaise: number;
  itemsCount: number;
  bonusItemsCount: number;
  bonusWindowDays: number;
  validityDays: number;
  sortOrder: number;
}

export interface PackOfferErrors {
  [field: string]: string;
}

/**
 * The same rules the Edge Function and the schema apply, so the form refuses what the server would.
 *
 * One definition would be better than three, and Edge Functions cannot import from the workspace —
 * so the function restates them, the schema constrains them, and this is the copy the browser uses.
 * Being told before you submit is a different job from being safe, and this file only does the
 * first.
 */
export function validatePackOffer(input: Partial<PackOfferInput>): PackOfferErrors | null {
  const errors: PackOfferErrors = {};

  const name = (input.name ?? '').trim();
  if (name === '') errors.name = 'Give the offer a name.';
  else if (name.length > 80) errors.name = 'Keep the name to 80 characters or fewer.';

  const positive: [keyof PackOfferInput, string][] = [
    ['netPricePaise', 'What does the pack cost, excluding GST?'],
    ['itemsCount', 'How many items does the pack contain?'],
    ['validityDays', 'How many days is the pack valid for?'],
  ];
  for (const [key, question] of positive) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) errors[key] = question;
  }

  // Zero is legitimate for both of these — a pack with no bonus is an ordinary pack.
  const nonNegative: [keyof PackOfferInput, string][] = [
    ['bonusItemsCount', 'How many bonus items? Use 0 for none.'],
    ['bonusWindowDays', 'How many days to earn the bonus? Use 0 for none.'],
  ];
  for (const [key, question] of nonNegative) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) errors[key] = question;
  }

  const bonusItems = input.bonusItemsCount;
  const bonusWindow = input.bonusWindowDays;

  /*
   * Bonus items and a bonus window are one decision, not two.
   *
   * `(bonus_items_count = 0) = (bonus_window_days = 0)` is a CHECK in the schema, and it is there
   * because either half alone **reads as a promise to a parent** that nothing can keep: a window
   * with no items promises a bonus that does not exist, and items with no window promise one that
   * can never be earned. It is also the single most likely thing to be typed into this form, which
   * is why it is caught here by name rather than surfacing as a constraint violation.
   */
  if (
    typeof bonusItems === 'number' && typeof bonusWindow === 'number' &&
    Number.isInteger(bonusItems) && Number.isInteger(bonusWindow) &&
    bonusItems >= 0 && bonusWindow >= 0 &&
    (bonusItems === 0) !== (bonusWindow === 0)
  ) {
    const message =
      bonusItems === 0
        ? 'A bonus window with no bonus items promises a parent nothing. Set both, or set both to 0.'
        : 'Bonus items with no window can never be earned. Set both, or set both to 0.';
    errors[bonusItems === 0 ? 'bonusItemsCount' : 'bonusWindowDays'] = message;
  }

  /*
   * A window that outlives the pack promises nothing either — the pack expires first, so the last
   * days of the window are unreachable. `bonus_window_days <= validity_days` in the schema.
   */
  if (
    typeof bonusWindow === 'number' && typeof input.validityDays === 'number' &&
    bonusWindow > 0 && input.validityDays > 0 && bonusWindow > input.validityDays
  ) {
    errors.bonusWindowDays =
      'The bonus window cannot outlast the pack — it would end after the items expire.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * What one item costs, for display beside the price.
 *
 * **Purchased items only** — the denominator is `itemsCount` and never `itemsCount +
 * bonusItemsCount`. Andy settled on 2026-09-16 that bonus items carry no value (`M10`), so dividing
 * by the bonus-inclusive total would print a per-item price the books never use and quietly suggest
 * the giveaway was paid for.
 *
 * Rounded for display with `Math.round`, and deliberately **not** reused for money: the exact
 * figure is always `half_up(price × items_remaining, items_count)` computed at the point of use,
 * because a stored per-item value cannot be exact in integer paise.
 */
export const perItemPricePaise = (offer: Pick<AdminPackOffer, 'netPricePaise' | 'itemsCount'>): number =>
  offer.itemsCount > 0 ? Math.round(offer.netPricePaise / offer.itemsCount) : 0;

export interface PackOfferResult {
  changed: string[];
  offer?: { id: string; name: string; is_active: boolean };
}

/**
 * How many packs each offer has sold.
 *
 * Through the function rather than a table read, because `meal_pack` is readable only by its owner
 * and a platform admin correctly cannot see other people's purchases. Only the count crosses the
 * wire: no owner, no order, no child.
 */
export async function fetchPackOfferSales(): Promise<Record<string, number>> {
  const result = await invokeFunction<{ sold: Record<string, number> }>(
    'admin-pack-offer', { action: 'summary' }, 'POST',
  );
  return result.sold ?? {};
}

/**
 * Create an offer.
 *
 * No `isActive` is sent, and that is the production guard rather than an omission: the column
 * default is `false`, so an offer cannot go live by being created. Restating `false` here would be
 * a second place to disagree with the schema.
 */
export const createPackOffer = (offer: PackOfferInput): Promise<PackOfferResult> =>
  invokeFunction<PackOfferResult>('admin-pack-offer', { action: 'create', offer }, 'POST');

/**
 * Change an offer.
 *
 * **Editing never alters a pack somebody already holds.** In the rebuilt model every term a pack
 * depends on is stamped onto it at sale — the offer's name (`name_snapshot`), the price, both tax
 * components, the item count, the bonus terms and the expiry — so an edit changes what the *next*
 * buyer gets and nothing else. That is the whole point of being able to edit a live offer.
 *
 * `E21-67` was this going wrong in the old model: `name` was read live, so renaming an offer
 * retitled packs already bought and reached an issued invoice's line description.
 *
 * If the server ever does freeze a field, it returns `already_sold` with the field named, and the
 * drawer shows that sentence. The screen explains; the Edge Function decides.
 */
export const updatePackOffer = (offerId: string, offer: Partial<PackOfferInput>): Promise<PackOfferResult> =>
  invokeFunction<PackOfferResult>('admin-pack-offer', { action: 'update', offerId, offer }, 'POST');

/** Activate or withdraw. Its own action, never a side effect of saving the form. */
export const setPackOfferActive = (offerId: string, isActive: boolean): Promise<PackOfferResult> =>
  invokeFunction<PackOfferResult>('admin-pack-offer', { action: 'setActive', offerId, isActive }, 'POST');

/**
 * Switch an offer on or off at one school.
 *
 * Called from `/admin/schools` — see the header. Absence of a row means **not offered**, so
 * switching a school on for the first time creates the row.
 */
export const setPackOfferSchool = (
  offerId: string, schoolId: string, isEnabled: boolean,
): Promise<PackOfferResult> =>
  invokeFunction<PackOfferResult>('admin-pack-offer', { action: 'setSchool', offerId, schoolId, isEnabled }, 'POST');

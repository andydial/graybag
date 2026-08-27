/**
 * Reading and writing meal pack offers, for the back office — `E21-60`.
 *
 * The parent-facing reads live in `meal-packs.ts` and show only **active** offers at a school that
 * has them switched on. This is the workshop rather than the shop window: every offer including
 * drafts, every school switch, and the writes.
 *
 * ## Two switches, both deliberate
 *
 * Andy: *"An offer is off by default — new offers are drafts, and a school shows packs only when
 * both the offer is live and the school's switch is on. Two switches, both mine."*
 *
 * So `is_active` on the offer and `is_enabled` on the offer/school pair are separate, and neither
 * implies the other. A screen that collapsed them into one control would be easier to use and
 * would make "live everywhere" the accident it is designed not to be.
 */
import { invokeFunction, runQuery } from './client.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export interface AdminPackOffer {
  id: string;
  name: string;
  mealsCount: number;
  itemsPerMeal: number;
  requiredCategoryId: string;
  requiredCategoryName: string;
  /** Integer paise, GST-exclusive like every price in this system (non-negotiable #3, #7). */
  netPricePaise: number;
  /** What the same meals cost singly. **Display only** — never used in a money calculation. */
  alacarteReferencePaise: number;
  validityDays: number;
  isActive: boolean;
  /** Schools this offer has a row for, and whether that row is switched on. */
  schools: { schoolId: string; schoolName: string; isEnabled: boolean }[];
}

export const ADMIN_PACK_OFFER_COLUMNS =
  'id,name,meals_count,items_per_meal,required_category_id,net_price_paise,' +
  'alacarte_reference_paise,validity_days,is_active,' +
  'category:required_category_id(display_name),' +
  'meal_pack_offer_school(school_id,is_enabled,school:school_id(name))';

/**
 * Every offer, drafts included.
 *
 * Gated by `meal_pack_offer_read_backoffice`, which needs `meal_packs.manage` at platform scope. A
 * caller without it gets an empty list rather than an error — the same `[AUTH-01]` ambiguity every
 * other admin read has, and the screen says both possibilities rather than picking one.
 */
export async function fetchAdminPackOffers(): Promise<AdminPackOffer[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('meal_pack_offer').select(ADMIN_PACK_OFFER_COLUMNS).order('name'),
  );

  return rows.filter(isRecord).map((row) => {
    const links = Array.isArray(row.meal_pack_offer_school) ? row.meal_pack_offer_school : [];
    return {
      id: str(row.id),
      name: str(row.name),
      mealsCount: num(row.meals_count),
      itemsPerMeal: num(row.items_per_meal),
      requiredCategoryId: str(row.required_category_id),
      requiredCategoryName: isRecord(row.category) ? str(row.category.display_name) : '',
      netPricePaise: num(row.net_price_paise),
      alacarteReferencePaise: num(row.alacarte_reference_paise),
      validityDays: num(row.validity_days),
      isActive: row.is_active === true,
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
  mealsCount: number;
  itemsPerMeal: number;
  requiredCategoryId: string;
  netPricePaise: number;
  alacarteReferencePaise: number;
  validityDays: number;
}

export interface PackOfferErrors {
  [field: string]: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The same rules the Edge Function applies, so the form refuses what the server would.
 *
 * One definition would be better than two, and Edge Functions cannot import from the workspace —
 * so the function restates them and this is the copy the browser uses. Where that duplication
 * matters most is the discount rule, which is also a database constraint: three statements of one
 * fact, and `admin-packs.test.ts` asserts this one agrees with the schema's wording.
 */
export function validatePackOffer(input: Partial<PackOfferInput>): PackOfferErrors | null {
  const errors: PackOfferErrors = {};

  const name = (input.name ?? '').trim();
  if (name === '') errors.name = 'Give the offer a name.';
  else if (name.length > 80) errors.name = 'Keep the name to 80 characters or fewer.';

  const positive: [keyof PackOfferInput, string][] = [
    ['mealsCount', 'How many meals are in the pack?'],
    ['itemsPerMeal', 'How many items make up one meal?'],
    ['netPricePaise', 'What does the pack cost, excluding GST?'],
    ['alacarteReferencePaise', 'What would those meals cost bought singly?'],
    ['validityDays', 'How many days is the pack valid for?'],
  ];
  for (const [key, question] of positive) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) errors[key] = question;
  }

  if (!UUID.test(input.requiredCategoryId ?? '')) {
    errors.requiredCategoryId = 'Choose the category one item of each meal must come from.';
  }

  /*
   * A pack must be cheaper than buying the meals singly, or it is not an offer.
   *
   * `meal_pack_offer_is_a_discount` in `0068` says the same, and the database is the one that
   * cannot be bypassed. This exists so the person filling the form is told before they submit,
   * which is a different job from being safe.
   */
  if (
    typeof input.netPricePaise === 'number' &&
    typeof input.alacarteReferencePaise === 'number' &&
    input.netPricePaise >= input.alacarteReferencePaise
  ) {
    errors.netPricePaise = 'A pack has to cost less than the same meals bought singly.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/** What the same meals cost singly, minus what the pack costs. Display only. */
export const packSavingPaise = (offer: Pick<AdminPackOffer, 'netPricePaise' | 'alacarteReferencePaise'>): number =>
  Math.max(0, offer.alacarteReferencePaise - offer.netPricePaise);

export interface PackOfferResult {
  changed: string[];
  offer?: { id: string; name: string; is_active: boolean };
}

/**
 * How many packs each offer has sold.
 *
 * Through the function rather than a table read, because `meal_pack` has one read policy —
 * `meal_pack_read_own` — and a platform admin correctly cannot see other people's purchases. Only
 * the count crosses the wire: no owner, no order, no child.
 */
export async function fetchPackOfferSales(): Promise<Record<string, number>> {
  const result = await invokeFunction<{ sold: Record<string, number> }>(
    'admin-pack-offer', { action: 'summary' }, 'POST',
  );
  return result.sold ?? {};
}

export const createPackOffer = (offer: PackOfferInput): Promise<PackOfferResult> =>
  invokeFunction<PackOfferResult>('admin-pack-offer', { action: 'create', offer }, 'POST');

/**
 * Change an offer.
 *
 * Rejected with `already_sold` if it changes `itemsPerMeal` or `requiredCategoryId` on an offer
 * that has sold — those two are the only fields a bought pack still reads live, so they are the
 * only ones that could rewrite what somebody already paid for. See the Edge Function's header.
 */
export const updatePackOffer = (offerId: string, offer: Partial<PackOfferInput>): Promise<PackOfferResult> =>
  invokeFunction<PackOfferResult>('admin-pack-offer', { action: 'update', offerId, offer }, 'POST');

export const setPackOfferActive = (offerId: string, isActive: boolean): Promise<PackOfferResult> =>
  invokeFunction<PackOfferResult>('admin-pack-offer', { action: 'setActive', offerId, isActive }, 'POST');

export const setPackOfferSchool = (
  offerId: string, schoolId: string, isEnabled: boolean,
): Promise<PackOfferResult> =>
  invokeFunction<PackOfferResult>('admin-pack-offer', { action: 'setSchool', offerId, schoolId, isEnabled }, 'POST');

export interface DishCategory {
  id: string;
  code: string;
  displayName: string;
}

/**
 * Every dish category, for the "one item must come from" picker — `E21-60`.
 *
 * A small read of its own rather than deriving the list from `fetchAdminDishes`. Deriving would
 * pull the whole catalogue to fill a dropdown, and — the part that actually matters — a category
 * with no dish in it would not appear, so a pack could never be configured to require one. That
 * is precisely the category somebody is about to add dishes to.
 *
 * `dish_category_read_all` grants this to any authenticated caller (`0002`), so it needs no
 * permission of its own.
 */
export async function fetchDishCategories(): Promise<DishCategory[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('dish_category').select('id,code,display_name').order('display_name'),
  );

  return rows.filter(isRecord).map((row) => ({
    id: str(row.id),
    code: str(row.code),
    displayName: str(row.display_name),
  }));
}

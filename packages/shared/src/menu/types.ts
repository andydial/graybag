/**
 * The menu domain, as TypeScript (`E04-01`, `E04-02`, `E04-03`).
 *
 * These mirror the tables in `0001_initial_schema.sql` §5–§6. They are deliberately a
 * *subset*: audit columns, `legacy_bubble_id` and the capacity table are not here, because
 * nothing in the app or the importer reads them and a type that models columns nobody uses
 * invites code that uses them.
 *
 * **Money is integer paise, everywhere, and the type says so** (non-negotiable #3). There is
 * no `number` field named `price` anywhere in this module that is not `_paise`.
 *
 * **Prices are GST-exclusive** (`SC2`, confirmed 2026-08-07): `price_paise` is the taxable
 * value and 5% is added at checkout. Nothing in this module computes tax — that is `E07`'s
 * job and it works from the order line, not from here.
 */

/** ISO weekday. 1 = Monday … 7 = Sunday, matching `menu_item.available_days`. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * A calendar date as `YYYY-MM-DD`.
 *
 * **Deliberately a string, not a `Date`.** A service date is a date in the platform
 * timezone, and a `Date` is an instant — converting between them is where `G9`'s bug lives
 * (05:20 IST on 1 April is 23:50 UTC on 31 March). Every function here that needs a weekday
 * derives it from the string arithmetically, so no timezone is ever consulted and the answer
 * cannot depend on where the code runs.
 */
export type ServiceDate = string;

export type MenuStatus = 'draft' | 'active' | 'retired';
export type AllergenPresence = 'contains' | 'may_contain';
export type FoodType = 'veg' | 'non_veg' | 'egg';

export interface Allergen {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  isMajor: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface DishAllergen {
  allergenId: string;
  presence: AllergenPresence;
}

export interface DishCategory {
  id: string;
  code: string;
  displayName: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Dish {
  id: string;
  kitchenId: string;
  name: string;
  description: string | null;
  ingredientsText: string | null;
  /** `null` when the source was unparseable. Never guessed (`MI2`). */
  caloriesKcal: number | null;
  portionText: string | null;
  categoryId: string;
  /** `[DM-17]` open — not a column in the source workbook, so the importer cannot fill it. */
  foodType: FoodType | null;
  imageAssetId: string | null;
  isActive: boolean;
  allergens: DishAllergen[];
  /**
   * `MI1`. True **only** when the source explicitly said "no allergens". False means nobody
   * has said, which is a different fact and must not be rendered as reassurance. Added to
   * the schema by `0006`, which is where the reasoning lives.
   */
  allergensDeclaredNone: boolean;
}

export interface MenuItem {
  id: string;
  menuId: string;
  dishId: string;
  /** Integer paise, GST-exclusive (`SC2`). */
  pricePaise: number;
  /** Overrides `dish.categoryId` when set. */
  categoryId: string | null;
  availableDays: IsoWeekday[];
  isActive: boolean;
  sortOrder: number;
}

export interface Menu {
  id: string;
  kitchenId: string;
  name: string;
  status: MenuStatus;
  /** Bumped on any change to the menu or its items (`E04-08`). */
  version: number;
}

export interface MenuAssignment {
  id: string;
  schoolId: string;
  menuId: string;
  /** Inclusive. */
  validFrom: ServiceDate;
  /** **Exclusive.** `null` is open-ended. */
  validTo: ServiceDate | null;
  revokedAt: string | null;
}

export interface MenuItemPriceOverride {
  id: string;
  schoolId: string;
  menuItemId: string;
  pricePaise: number;
  /** Inclusive. */
  validFrom: ServiceDate;
  /** **Exclusive.** `null` is open-ended. */
  validTo: ServiceDate | null;
}

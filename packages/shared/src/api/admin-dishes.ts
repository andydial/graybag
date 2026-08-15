/**
 * The dish and menu catalogue, for editing one thing at a time — `E10-20`.
 *
 * `tools/bulk-import` is the other half and does the heavy lifting: a few hundred rows from a
 * file, planned and applied in one pass. This is the Tuesday afternoon when one price is wrong,
 * where preparing a CSV, dry-running it and applying it is six minutes of ceremony for a
 * four-character change — and the ceremony is what makes somebody edit the database by hand.
 *
 * Reads go through PostgREST under RLS; the writes go through the `admin-dish` Edge Function
 * (`A4`, non-negotiable #1).
 *
 * ## Why the menu read joins rather than being two calls
 *
 * A price belongs to a `(menu, dish)` pair, so a screen that lets somebody change one has to show
 * both. PostgREST embeds the dish, which keeps it one round trip on a connection the performance
 * priorities describe as the real constraint.
 */
import { invokeFunction, runQuery } from './client.js';

export interface AdminDish {
  id: string;
  name: string;
  kitchenId: string;
  categoryCode: string;
  categoryName: string;
  /** `veg` | `non_veg` | `egg`, or null — `[DM-17]` leaves it nullable because the source had no such field. */
  foodType: string | null;
  description: string | null;
  ingredientsText: string | null;
  caloriesKcal: number | null;
  /**
   * Calories as the source gave them — "330-370", a range the importer could not turn into an
   * integer and refused to guess at (`0001` on `calories_kcal`: "left NULL when unparseable,
   * never guessed").
   *
   * Read from the `calories_text` **column**, falling back to `nutrition->>'calories_text'` where
   * the import put it. 76 of the 79 production dishes have it only in the jsonb. Writes go to the
   * column, so an edited dish stops depending on the fallback — see `nutrition` below.
   */
  caloriesText: string | null;
  portionText: string | null;
  /**
   * The unstructured extras `0001` describes as "nothing queries it". On production it holds
   * exactly `{"calories_text": "…"}` and, on four dishes, `calories_text_conflicting` where the
   * source had two different values. Exposed read-only: it is a record of what was imported, and
   * editing free-form JSON in a browser form is not a thing this screen should offer.
   */
  nutrition: Record<string, unknown> | null;
  isActive: boolean;
  /**
   * `asset.id`, or null. **Nothing in this repository writes it** — the `dish-images` bucket and
   * the `asset` table both exist, and no code path uploads to either, so all 79 production dishes
   * have no image. Surfaced so the screen can say that plainly instead of showing a control that
   * does nothing.
   */
  imageAssetId: string | null;
  /** Allergen **codes**, the shared vocabulary `recipient_allergen` also uses. */
  allergens: string[];
  /**
   * `MI1` and `0006`. An empty `allergens` list means one of **two opposite things**, and this
   * flag is the only thing that tells them apart:
   *
   *     allergens.length > 0            declared, and these are they
   *     [] and declaredNone === true    declared, and there are none
   *     [] and declaredNone === false   NOBODY HAS LOOKED — warn, never reassure
   *
   * Every production dish is currently in the third state.
   */
  allergensDeclaredNone: boolean;
}

export class AdminDishError extends Error {
  constructor(detail: string) {
    super(`The catalogue is not usable: ${detail}`);
    this.name = 'AdminDishError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/**
 * Spelled out rather than globbed, for the reason every column list in this module is.
 *
 * `dish_allergen` is embedded so the codes arrive with the dish — the alternative is a second
 * round trip and a join in the browser, and the codes are the field most likely to be edited.
 */
export const ADMIN_DISH_COLUMNS =
  'id,name,kitchen_id,food_type,description,ingredients_text,calories_kcal,calories_text,' +
  'portion_text,nutrition,image_asset_id,is_active,allergens_declared_none,' +
  'category:category_id(code,display_name),dish_allergen(allergen:allergen_id(code))';

export async function fetchAdminDishes(): Promise<AdminDish[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('dish').select(ADMIN_DISH_COLUMNS).order('name'),
  );

  return rows.map((row, i) => {
    if (!isRecord(row)) throw new AdminDishError(`row ${i} is not an object`);
    const id = str(row.id);
    const name = str(row.name);
    if (!id || !name) throw new AdminDishError(`row ${i} has no id or name`);

    const category = isRecord(row.category) ? row.category : {};
    const allergens = Array.isArray(row.dish_allergen)
      ? row.dish_allergen
          .map((da) => (isRecord(da) && isRecord(da.allergen) ? str(da.allergen.code) : null))
          .filter((c): c is string => c !== null)
          .sort()
      : [];

    return {
      id,
      name,
      kitchenId: str(row.kitchen_id) ?? '',
      categoryCode: str(category.code) ?? '',
      categoryName: str(category.display_name) ?? '',
      foodType: str(row.food_type),
      description: str(row.description),
      ingredientsText: str(row.ingredients_text),
      caloriesKcal: num(row.calories_kcal),
      // The column first, the imported jsonb second. 76 production dishes have this only in
      // `nutrition`, and a screen that read only the column would show 76 blanks over data that
      // is right there.
      caloriesText: str(row.calories_text) ?? (isRecord(row.nutrition) ? str(row.nutrition.calories_text) : null),
      portionText: str(row.portion_text),
      nutrition: isRecord(row.nutrition) ? row.nutrition : null,
      isActive: row.is_active !== false,
      imageAssetId: str(row.image_asset_id),
      allergens,
      allergensDeclaredNone: row.allergens_declared_none === true,
    };
  });
}

export interface AdminMenu {
  id: string;
  name: string;
  kitchenId: string;
  status: string;
  items: AdminMenuItem[];
}

/**
 * Which menu a school is serving — `E10-22`.
 *
 * The link that made the catalogue unreadable by its absence: a menu and a school were each
 * visible on their own, and nothing on any screen joined them. "Is Gem seeded correctly?" was
 * unanswerable without opening the database, which on the week before launch is the one question
 * being asked.
 *
 * A school can hold **several** assignment rows — that is how a menu changes mid-term without
 * losing the record of what was served before. `revoked_at` and the date window decide which one
 * is live, and both are kept here rather than resolved away, because "Paragon's menu starts on
 * the 22nd" and "Paragon has no menu" look identical once you throw the dates out.
 */
export interface AdminMenuAssignment {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  menuId: string;
  menuName: string;
  /** `YYYY-MM-DD`. **Inclusive** — the first day the menu is served. */
  validFrom: string;
  /**
   * `YYYY-MM-DD`, or null for open-ended. **EXCLUSIVE** — the first day it is *not* served.
   *
   * Not a preference: `0001` constrains the column with
   * `daterange(valid_from, coalesce(valid_to, 'infinity'), '[)')`, and every read in the system —
   * the RLS policies, the public menu view, `create_checkout` — tests `valid_to > current_date`.
   */
  validTo: string | null;
  revokedAt: string | null;
}

export const ADMIN_ASSIGNMENT_COLUMNS =
  'school_id,menu_id,valid_from,valid_to,revoked_at,school:school_id(name,code),menu:menu_id(name)';

export async function fetchMenuAssignments(): Promise<AdminMenuAssignment[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('menu_assignment').select(ADMIN_ASSIGNMENT_COLUMNS),
  );

  return rows.map((row, i) => {
    if (!isRecord(row)) throw new AdminDishError(`assignment ${i} is not an object`);
    const school = isRecord(row.school) ? row.school : {};
    const menu = isRecord(row.menu) ? row.menu : {};
    return {
      schoolId: str(row.school_id) ?? '',
      schoolName: str(school.name) ?? '',
      schoolCode: str(school.code) ?? '',
      menuId: str(row.menu_id) ?? '',
      menuName: str(menu.name) ?? '',
      validFrom: str(row.valid_from) ?? '',
      validTo: str(row.valid_to),
      revokedAt: str(row.revoked_at),
    };
  });
}

/**
 * Is this assignment the one in force on `today`?
 *
 * `today` is passed in rather than read from the clock so it is testable and so the caller can
 * hand it an **IST** service date — the day rolls at 18:30 UTC, and a screen that decided
 * liveness from the browser's local midnight would show the wrong menu to anyone not in India
 * for five and a half hours a day.
 *
 * Dates compare as strings on purpose: `YYYY-MM-DD` is lexicographically ordered, both sides come
 * from Postgres `date` columns in that exact shape, and parsing them into `Date` is how a
 * timezone gets reintroduced into a comparison that must not have one.
 *
 * **`valid_to` is exclusive**, matching `0001`'s `'[)'` daterange and the `valid_to > current_date`
 * every read in the system uses. The first version of this function had it inclusive, which would
 * have shown an admin a school still serving a menu on the day the parent-facing app had already
 * stopped serving it — the admin screen quietly disagreeing with the app about what is on sale.
 */
export function isAssignmentLive(a: AdminMenuAssignment, today: string): boolean {
  if (a.revokedAt !== null) return false;
  if (a.validFrom > today) return false;
  return a.validTo === null || a.validTo > today;
}

export interface AdminMenuItem {
  menuId: string;
  dishId: string;
  dishName: string;
  /** Integer paise. Never a float, anywhere (non-negotiable #3). */
  pricePaise: number;
  availableDays: number[];
  isActive: boolean;
}

export const ADMIN_MENU_COLUMNS =
  'id,name,kitchen_id,status,' +
  'menu_item(menu_id,dish_id,price_paise,available_days,is_active,dish:dish_id(name))';

export async function fetchAdminMenus(): Promise<AdminMenu[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('menu').select(ADMIN_MENU_COLUMNS).order('name'),
  );

  return rows.map((row, i) => {
    if (!isRecord(row)) throw new AdminDishError(`menu ${i} is not an object`);
    const id = str(row.id);
    if (!id) throw new AdminDishError(`menu ${i} has no id`);

    const items = Array.isArray(row.menu_item) ? row.menu_item : [];

    return {
      id,
      name: str(row.name) ?? '',
      kitchenId: str(row.kitchen_id) ?? '',
      status: str(row.status) ?? 'draft',
      items: items.filter(isRecord).map((item) => {
        const price = item.price_paise;
        // A price is the one field here that must not be coerced. `Number(null)` is 0, and a
        // dish silently priced at zero reads as a free item rather than as a bug.
        if (typeof price !== 'number' || !Number.isInteger(price)) {
          throw new AdminDishError(`a menu item on "${str(row.name) ?? id}" has a non-integer price`);
        }
        return {
          menuId: str(item.menu_id) ?? id,
          dishId: str(item.dish_id) ?? '',
          dishName: isRecord(item.dish) ? (str(item.dish.name) ?? '') : '',
          pricePaise: price,
          availableDays: Array.isArray(item.available_days) ? item.available_days.map(Number) : [],
          isActive: item.is_active !== false,
        };
      }).sort((a, b) => a.dishName.localeCompare(b.dishName)),
    };
  });
}

// ---------------------------------------------------------------------------- writes

export interface DishEdit {
  id: string;
  /** What a parent reads on the menu. Never blank — a nameless dish is unorderable in practice. */
  name?: string;
  foodType?: string | null;
  description?: string | null;
  ingredientsText?: string | null;
  caloriesKcal?: number | null;
  /** Writes the `calories_text` **column**, which then wins over the imported `nutrition` jsonb. */
  caloriesText?: string | null;
  portionText?: string | null;
  isActive?: boolean;
  /** Replaces the whole set. Send the codes you want the dish to end up with. */
  allergens?: string[];
  /** Records "we checked, there are none" — a different fact from an empty list. See `AdminDish`. */
  allergensDeclaredNone?: boolean;
}

export interface MenuItemEdit {
  menuId: string;
  dishId: string;
  pricePaise?: number;
  availableDays?: number[];
  isActive?: boolean;
}

export interface CatalogueUpdateResult {
  /** What the server actually changed. Menu-item fields are prefixed `menuItem.`. */
  changed: string[];
}

/**
 * Edit a dish, a menu item, or both in one call.
 *
 * **Send only the keys you mean to change.** An absent key is left alone; a key set to `null`
 * clears the column. Sending a whole object with untouched fields as `undefined` is the failure
 * this shape invites — `JSON.stringify` drops them, which reads to the server as "absent", so
 * that particular mistake is safe here. The dangerous one is sending `null` for a field you
 * merely did not edit.
 *
 * `allergens` is a **replace**, not a merge: the server clears and re-inserts. Sending `[]`
 * removes every allergen from the dish, which is a real thing somebody may mean and is why it is
 * not treated as "no opinion".
 */
export async function updateCatalogue(edit: {
  dish?: DishEdit;
  menuItem?: MenuItemEdit;
}): Promise<CatalogueUpdateResult> {
  return invokeFunction<CatalogueUpdateResult>('admin-dish', edit, 'PATCH');
}

export interface FoodTypeAssignment {
  id: string;
  /** `veg` | `non_veg` | `egg`, or `null` to unset it again. */
  foodType: string | null;
}

/**
 * Set `food_type` on many dishes at once — `E10-21`.
 *
 * 79 dishes reached production with this null on every one of them. In this market a parent who
 * cannot tell whether a dish is vegetarian is the most likely day-one complaint, and setting it
 * one dish at a time is 79 round trips and a lost afternoon.
 *
 * **Only `food_type`.** Deliberately not a general mass-update: an endpoint that applied an
 * arbitrary patch to 500 rows is one careless caller away from retiring a catalogue, and no
 * operator task needs it.
 *
 * **All or nothing.** The server validates every entry before writing any, so a bad id at
 * position 60 does not leave the first 59 changed — which is the failure that would make somebody
 * distrust the whole screen and go back to editing rows by hand.
 */
export async function setFoodTypes(assignments: FoodTypeAssignment[]): Promise<CatalogueUpdateResult> {
  return invokeFunction<CatalogueUpdateResult>('admin-dish', { foodTypes: assignments }, 'PATCH');
}

export interface DishAllergenAssignment {
  id: string;
  /** Allergen codes the dish should end up with. A replace, not a merge. */
  allergens: string[];
  /**
   * True records **"we checked, there are none"**. Mutually exclusive with a non-empty
   * `allergens` — the server refuses both together rather than picking, because those are
   * opposite claims and guessing which was meant is how a dish comes to reassure a parent.
   */
  declaredNone?: boolean;
}

/**
 * Tag many dishes at once — `E10-33`.
 *
 * All 79 production dishes are in `MI1`'s third state: no tags, and nobody has said there are
 * none. That is the state the app must **warn** about, and it looks identical on screen to a dish
 * that genuinely contains nothing. Clearing it one request at a time is 79 round trips.
 *
 * **All or nothing.** Every entry is validated before a single row is written — on this table a
 * partial write is worse than a failure, because the half that succeeded looks complete.
 */
export async function setDishAllergens(
  assignments: DishAllergenAssignment[],
): Promise<CatalogueUpdateResult> {
  return invokeFunction<CatalogueUpdateResult>('admin-dish', { dishAllergens: assignments }, 'PATCH');
}

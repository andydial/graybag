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
  portionText: string | null;
  isActive: boolean;
  /** Allergen **codes**, the shared vocabulary `recipient_allergen` also uses. */
  allergens: string[];
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
  'id,name,kitchen_id,food_type,description,ingredients_text,calories_kcal,portion_text,is_active,' +
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
      portionText: str(row.portion_text),
      isActive: row.is_active !== false,
      allergens,
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
  foodType?: string | null;
  description?: string | null;
  ingredientsText?: string | null;
  caloriesKcal?: number | null;
  portionText?: string | null;
  isActive?: boolean;
  /** Replaces the whole set. Send the codes you want the dish to end up with. */
  allergens?: string[];
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

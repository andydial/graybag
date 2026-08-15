import { afterEach, describe, expect, it, vi } from 'vitest';

import { setApiTransport, type ApiTransport } from './client.js';
import { fakeTransport } from './test-support.js';
import {
  ADMIN_DISH_COLUMNS,
  ADMIN_MENU_COLUMNS,
  AdminDishError,
  fetchAdminDishes,
  fetchAdminMenus,
  updateCatalogue,
} from './admin-dishes.js';

afterEach(() => setApiTransport(null));

const DISH = {
  id: 'd-1',
  name: 'Veg Sandwich',
  kitchen_id: 'k-1',
  food_type: 'veg',
  description: 'Atta bread',
  ingredients_text: null,
  calories_kcal: 220,
  portion_text: '1 sandwich',
  is_active: true,
  category: { code: 'quick_bites', display_name: 'Quick Bites' },
  dish_allergen: [{ allergen: { code: 'milk' } }, { allergen: { code: 'gluten' } }],
};

const MENU = {
  id: 'm-1',
  name: 'Term 1 2026',
  kitchen_id: 'k-1',
  status: 'active',
  menu_item: [
    { menu_id: 'm-1', dish_id: 'd-2', price_paise: 6000, available_days: [1, 3, 5], is_active: true, dish: { name: 'Paneer Wrap' } },
    { menu_id: 'm-1', dish_id: 'd-1', price_paise: 4500, available_days: [1, 2, 3, 4, 5], is_active: true, dish: { name: 'Veg Sandwich' } },
  ],
};

function stub(answer: { data?: unknown; error?: Error | null }) {
  const invoke = vi.fn().mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null });
  setApiTransport({
    from: () => {
      throw new Error('this test must not read a table');
    },
    functions: { invoke },
  } as unknown as ApiTransport);
  return invoke;
}

describe('fetchAdminDishes', () => {
  it('flattens the embedded category and the allergen codes', async () => {
    setApiTransport(fakeTransport([DISH]).transport);
    const [dish] = await fetchAdminDishes();
    expect(dish!.categoryCode).toBe('quick_bites');
    expect(dish!.categoryName).toBe('Quick Bites');
    expect(dish!.allergens).toEqual(['gluten', 'milk']);
  });

  it('sorts allergen codes, so two dishes with the same set compare equal on screen', async () => {
    setApiTransport(fakeTransport([{ ...DISH, dish_allergen: [{ allergen: { code: 'milk' } }, { allergen: { code: 'egg' } }] }]).transport);
    expect((await fetchAdminDishes())[0]!.allergens).toEqual(['egg', 'milk']);
  });

  it('reads a dish with no allergens as an empty list, not as unknown', async () => {
    setApiTransport(fakeTransport([{ ...DISH, dish_allergen: [] }]).transport);
    expect((await fetchAdminDishes())[0]!.allergens).toEqual([]);
  });

  it('keeps a null food type null — it is [DM-17], not missing data', async () => {
    // The source Excel had no such column, so the schema allows null. Defaulting it to `veg`
    // here would be inventing a fact about food, which is the one thing this field must not do.
    setApiTransport(fakeTransport([{ ...DISH, food_type: null }]).transport);
    expect((await fetchAdminDishes())[0]!.foodType).toBeNull();
  });

  it('treats is_active false as false, not as absent', async () => {
    setApiTransport(fakeTransport([{ ...DISH, is_active: false }]).transport);
    expect((await fetchAdminDishes())[0]!.isActive).toBe(false);
  });

  it('never selects *', () => {
    expect(ADMIN_DISH_COLUMNS).not.toContain('*');
    expect(ADMIN_MENU_COLUMNS).not.toContain('*');
  });

  it('refuses a dish with no name rather than rendering a blank row', async () => {
    setApiTransport(fakeTransport([{ ...DISH, name: null }]).transport);
    await expect(fetchAdminDishes()).rejects.toThrow(AdminDishError);
  });
});

describe('fetchAdminMenus', () => {
  it('reads items and sorts them by dish name', async () => {
    setApiTransport(fakeTransport([MENU]).transport);
    const [menu] = await fetchAdminMenus();
    expect(menu!.items.map((i) => i.dishName)).toEqual(['Paneer Wrap', 'Veg Sandwich']);
  });

  it('keeps prices as integer paise', async () => {
    setApiTransport(fakeTransport([MENU]).transport);
    const [menu] = await fetchAdminMenus();
    expect(menu!.items.find((i) => i.dishName === 'Veg Sandwich')!.pricePaise).toBe(4500);
  });

  it('refuses a non-integer price rather than rendering a free item', async () => {
    // `Number(null)` is 0, and a dish silently priced at zero reads as a free item rather than
    // as a bug — the one error on this screen nobody would question.
    setApiTransport(fakeTransport([{ ...MENU, menu_item: [{ ...MENU.menu_item[0], price_paise: null }] }]).transport);
    await expect(fetchAdminMenus()).rejects.toThrow(AdminDishError);
    setApiTransport(fakeTransport([{ ...MENU, menu_item: [{ ...MENU.menu_item[0], price_paise: 45.5 }] }]).transport);
    await expect(fetchAdminMenus()).rejects.toThrow(AdminDishError);
  });

  it('reads a menu with no items as an empty list', async () => {
    setApiTransport(fakeTransport([{ ...MENU, menu_item: [] }]).transport);
    expect((await fetchAdminMenus())[0]!.items).toEqual([]);
  });
});

describe('updateCatalogue', () => {
  it('PATCHes the admin-dish Edge Function — writes never touch a table', async () => {
    const invoke = stub({ data: { changed: ['food_type'] } });
    const result = await updateCatalogue({ dish: { id: 'd-1', foodType: 'egg' } });
    expect(result.changed).toEqual(['food_type']);
    expect(invoke.mock.calls[0]![0]).toBe('admin-dish');
    expect(invoke.mock.calls[0]![1].method).toBe('PATCH');
  });

  it('sends only what the caller set', async () => {
    // The failure this guards: a form that posts every field it knows about blanks the ones it
    // did not show. `undefined` is dropped by JSON.stringify, so that mistake is safe — the
    // dangerous one is sending `null` for a field nobody edited, which this shape makes explicit.
    const invoke = stub({ data: { changed: [] } });
    await updateCatalogue({ dish: { id: 'd-1', caloriesKcal: 300 } });
    const body = invoke.mock.calls[0]![1].body as { dish: Record<string, unknown> };
    expect(Object.keys(body.dish).sort()).toEqual(['caloriesKcal', 'id']);
  });

  it('carries an explicit null through, because clearing a column is a real edit', async () => {
    const invoke = stub({ data: { changed: [] } });
    await updateCatalogue({ dish: { id: 'd-1', description: null } });
    const body = invoke.mock.calls[0]![1].body as { dish: Record<string, unknown> };
    expect(body.dish.description).toBeNull();
  });

  it('sends an empty allergen list rather than omitting it', async () => {
    // `[]` means "this dish has no allergens", which is a thing somebody may genuinely mean.
    // Treating it as "no opinion" would make removing the last allergen impossible.
    const invoke = stub({ data: { changed: ['allergens'] } });
    await updateCatalogue({ dish: { id: 'd-1', allergens: [] } });
    const body = invoke.mock.calls[0]![1].body as { dish: Record<string, unknown> };
    expect(body.dish.allergens).toEqual([]);
  });

  it('addresses a menu item by BOTH ids', async () => {
    // `menu_item` is unique on the pair. Addressing by dish alone would reprice that dish on
    // every menu it appears on, which is exactly the mistake a single-price edit must not make.
    const invoke = stub({ data: { changed: ['menuItem.price_paise'] } });
    await updateCatalogue({ menuItem: { menuId: 'm-1', dishId: 'd-1', pricePaise: 5000 } });
    const body = invoke.mock.calls[0]![1].body as { menuItem: Record<string, unknown> };
    expect(body.menuItem.menuId).toBe('m-1');
    expect(body.menuItem.dishId).toBe('d-1');
  });

  it('can change a dish and a price in one call', async () => {
    const invoke = stub({ data: { changed: ['food_type', 'menuItem.price_paise'] } });
    const result = await updateCatalogue({
      dish: { id: 'd-1', foodType: 'veg' },
      menuItem: { menuId: 'm-1', dishId: 'd-1', pricePaise: 5000 },
    });
    expect(result.changed).toHaveLength(2);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

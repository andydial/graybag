/**
 * A catalogue the a11y audit and a designer can open without a session — `E10-20`.
 *
 * The interesting shape, not the tidy one: a dish with **no food type** (the `[DM-17]` state the
 * importer also calls out), a **retired** dish, a dish with no allergens, and a menu item that is
 * inactive. Each of those looks identical to a healthy row in a list that shows only names, which
 * is why this screen labels them.
 */
import type { api } from '@graybag/shared';

export const MENUS_FIXTURE: {
  dishes: api.AdminDish[];
  menus: api.AdminMenu[];
  schools: api.AdminSchool[];
  assignments: api.AdminMenuAssignment[];
} = {
  dishes: [
    {
      id: 'd-1', name: 'Veg Sandwich', kitchenId: 'k-1',
      categoryCode: 'quick_bites', categoryName: 'Quick Bites',
      foodType: 'veg', description: 'Atta bread, seasonal vegetables',
      ingredientsText: null, caloriesKcal: 220, portionText: '1 sandwich',
      isActive: true, allergens: ['gluten', 'milk'],
    },
    {
      id: 'd-2', name: 'Paneer Wrap', kitchenId: 'k-1',
      categoryCode: 'main_meals', categoryName: 'Main Meals',
      foodType: 'veg', description: null, ingredientsText: null,
      caloriesKcal: 340, portionText: '1 wrap', isActive: true, allergens: ['milk'],
    },
    {
      // No food type. The importer prints NO FOOD TYPE for exactly this row; so does this screen.
      id: 'd-3', name: 'Fruit Bowl', kitchenId: 'k-1',
      categoryCode: 'quick_bites', categoryName: 'Quick Bites',
      foodType: null, description: null, ingredientsText: null,
      caloriesKcal: 110, portionText: '150 g', isActive: true, allergens: [],
    },
    {
      id: 'd-4', name: 'Chocolate Muffin', kitchenId: 'k-1',
      categoryCode: 'quick_bites', categoryName: 'Quick Bites',
      foodType: 'egg', description: null, ingredientsText: null,
      caloriesKcal: 290, portionText: '1 muffin', isActive: false, allergens: ['gluten', 'milk'],
    },
  ],
  menus: [
    {
      id: 'm-1', name: 'Term 1 2026', kitchenId: 'k-1', status: 'active',
      items: [
        { menuId: 'm-1', dishId: 'd-3', dishName: 'Fruit Bowl', pricePaise: 3000, availableDays: [1, 2, 3, 4, 5, 6], isActive: true },
        { menuId: 'm-1', dishId: 'd-2', dishName: 'Paneer Wrap', pricePaise: 6000, availableDays: [1, 3, 5], isActive: true },
        { menuId: 'm-1', dishId: 'd-1', dishName: 'Veg Sandwich', pricePaise: 4500, availableDays: [1, 2, 3, 4, 5], isActive: true },
        { menuId: 'm-1', dishId: 'd-4', dishName: 'Chocolate Muffin', pricePaise: 5000, availableDays: [5], isActive: false },
      ],
    },
  ],

  /**
   * Three schools in the three states the school → menu view exists to tell apart, because on a
   * screen that does not join them all three look the same: **serving**, **starts later**, and
   * **nothing assigned**. The middle one is the case that reads as broken when it is correct.
   */
  schools: [
    {
      id: 's-1', code: 'amity', name: 'Amity International School', cityName: 'Mohali',
      kitchenId: 'k-1', kitchenName: 'Mohali Kitchen', institutionType: 'school',
      addressLine1: null, addressLine2: null, postcode: null,
      contactName: null, contactEmail: null, contactPhone: null,
      isActive: true, onboardedAt: '2026-08-01',
    },
    {
      id: 's-2', code: 'paragon', name: 'Paragon Senior Secondary', cityName: 'Mohali',
      kitchenId: 'k-1', kitchenName: 'Mohali Kitchen', institutionType: 'school',
      addressLine1: null, addressLine2: null, postcode: null,
      contactName: null, contactEmail: null, contactPhone: null,
      isActive: true, onboardedAt: '2026-08-01',
    },
    {
      id: 's-3', code: 'gem', name: 'Gem Public School', cityName: 'Mohali',
      kitchenId: 'k-1', kitchenName: 'Mohali Kitchen', institutionType: 'school',
      addressLine1: null, addressLine2: null, postcode: null,
      contactName: null, contactEmail: null, contactPhone: null,
      isActive: true, onboardedAt: '2026-08-01',
    },
  ],
  assignments: [
    {
      schoolId: 's-1', schoolName: 'Amity International School', schoolCode: 'amity',
      menuId: 'm-1', menuName: 'Term 1 2026',
      validFrom: '2026-01-01', validTo: null, revokedAt: null,
    },
    {
      // Correctly configured, not yet in force. Far enough out that the fixture does not go stale.
      schoolId: 's-2', schoolName: 'Paragon Senior Secondary', schoolCode: 'paragon',
      menuId: 'm-1', menuName: 'Term 1 2026',
      validFrom: '2099-01-01', validTo: null, revokedAt: null,
    },
  ],
};

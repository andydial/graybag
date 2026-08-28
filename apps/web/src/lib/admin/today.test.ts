import { describe, expect, it } from 'vitest';

import type { api } from '@graybag/shared';

import type { SchoolMenuRow } from './catalogue-view.js';
import type { SchoolReadiness } from './school-readiness.js';
import {
  attention,
  boardRows,
  dishesBlockingOrders,
  ordersToday,
  packsToday,
  revenueToday,
  sortBoard,
} from './today.js';

const kitchenOrder = (o: Partial<api.ApiKitchenOrder> = {}): api.ApiKitchenOrder => ({
  id: 'k-1', orderRef: 'GB-1', schoolId: 's-1', schoolName: 'Amity', breakId: null,
  breakLabel: 'First break', recipientName: 'Child One', classLabel: '4', sectionLabel: 'A',
  status: 'paid', pickupCode: null, allergenCodes: [],
  lines: [{ dishId: 'd-1', dishName: 'Wrap', quantity: 1, note: null }],
  ...o,
});

const adminOrder = (o: Partial<api.AdminOrder> = {}): api.AdminOrder => ({
  id: 'k-1', orderRef: 'GB-1', serviceDate: '2026-08-28', status: 'paid',
  schoolId: 's-1', schoolName: 'Amity', kitchenId: 'kit-1', breakLabel: 'First break',
  recipientName: 'Child One', classLabel: '4', sectionLabel: 'A',
  subtotalPaise: 10_000, taxPaise: 500, discountPaise: 0, totalPaise: 10_500, refundedPaise: 0,
  ...o,
});

const dish = (o: Partial<api.AdminDish> & { id: string }): api.AdminDish => ({
  name: `Dish ${o.id}`, kitchenId: 'kit-1', categoryCode: 'main', categoryName: 'Meals',
  foodType: 'veg', description: null, ingredientsText: null, caloriesKcal: null,
  caloriesText: null, portionText: null, nutrition: null, isActive: true,
  imageAssetId: null, allergens: [], allergensDeclaredNone: false,
  ...o,
});

describe('ordersToday', () => {
  it('counts by status, and counts cancelled separately', () => {
    const t = ordersToday([
      kitchenOrder({ id: 'a', status: 'paid' }),
      kitchenOrder({ id: 'b', status: 'delivered' }),
      kitchenOrder({ id: 'c', status: 'cancelled' }),
    ]);
    expect(t.total).toBe(3);
    expect(t.byStatus).toEqual({ paid: 1, delivered: 1, cancelled: 1 });
    // A cancelled order is on the board and is not a meal to make. Both facts matter, so both
    // are carried rather than one being inferred from the other.
    expect(t.cancelled).toBe(1);
  });

  it('is zero orders, not a missing panel, for a day nobody ordered', () => {
    expect(ordersToday([])).toEqual({ total: 0, byStatus: {}, cancelled: 0 });
  });
});

describe('revenueToday', () => {
  it('excludes cancelled and refunded from gross, and counts them', () => {
    const t = revenueToday([
      adminOrder({ id: 'a', totalPaise: 10_000 }),
      adminOrder({ id: 'b', totalPaise: 20_000, status: 'delivered' }),
      // Cancelled money is not revenue. Counting it would overstate the day to exactly the person
      // who reads this card to answer "what did we take".
      adminOrder({ id: 'c', totalPaise: 50_000, status: 'cancelled' }),
      adminOrder({ id: 'd', totalPaise: 90_000, status: 'refunded', refundedPaise: 90_000 }),
    ]);
    expect(t.grossPaise).toBe(30_000);
    expect(t.cancelled).toBe(2);
    expect(t.refundedPaise).toBe(90_000);
    expect(t.netPaise).toBe(-60_000);
  });

  it('subtracts a partial refund from net without removing the order from gross', () => {
    // The order still happened and the food was still made. Half the money came back.
    const t = revenueToday([adminOrder({ totalPaise: 20_000, refundedPaise: 8_000 })]);
    expect(t.grossPaise).toBe(20_000);
    expect(t.netPaise).toBe(12_000);
  });

  it('is integer paise throughout — non-negotiable #3', () => {
    const t = revenueToday([adminOrder({ totalPaise: 33 }), adminOrder({ id: 'b', totalPaise: 34 })]);
    expect(Number.isInteger(t.grossPaise)).toBe(true);
    expect(t.grossPaise).toBe(67);
  });
});

describe('packsToday', () => {
  const offer = (o: Partial<api.AdminPackOffer> & { id: string }): api.AdminPackOffer => ({
    name: 'Ten', mealsCount: 10, itemsPerMeal: 2, requiredCategoryId: 'c-1',
    requiredCategoryName: 'Drinks', netPricePaise: 450_000, alacarteReferencePaise: 500_000,
    validityDays: 90, isActive: true, schools: [],
    ...o,
  });

  it('multiplies each offer by its own sales rather than by an average', () => {
    const t = packsToday(
      [offer({ id: 'a' }), offer({ id: 'b', mealsCount: 20, netPricePaise: 860_000 })],
      { a: 3, b: 2 },
    );
    expect(t.packsSold).toBe(5);
    expect(t.collectedPaise).toBe(3 * 450_000 + 2 * 860_000);
    expect(t.mealsSold).toBe(3 * 10 + 2 * 20);
  });

  it('counts live offers, not all of them — a draft is not on sale', () => {
    const t = packsToday([offer({ id: 'a' }), offer({ id: 'b', isActive: false })], {});
    expect(t.liveOffers).toBe(1);
  });

  it('reports an offer nobody has bought as zero rather than dropping it', () => {
    expect(packsToday([offer({ id: 'a' })], {})).toMatchObject({ packsSold: 0, mealsSold: 0 });
  });
});

describe('dishesBlockingOrders', () => {
  const menuRow = (
    live: { items: { dishId: string; isActive: boolean }[] } | null,
    schoolName = 'Amity',
  ): SchoolMenuRow =>
    ({
      school: { id: `s-${schoolName}`, name: schoolName },
      live: live === null ? null : { assignment: {}, menu: { items: live.items } },
      upcoming: [], orderable: 0, problems: [],
    }) as unknown as SchoolMenuRow;

  it('counts an unmarked dish a parent can actually put in a cart', () => {
    const found = dishesBlockingOrders(
      [menuRow({ items: [{ dishId: 'd-1', isActive: true }] })],
      [dish({ id: 'd-1', name: 'Mystery Wrap', foodType: null })],
    );
    expect(found.count).toBe(1);
    expect(found.names).toEqual(['Mystery Wrap']);
    expect(found.schools).toEqual(['Amity']);
  });

  /*
   * The distinction the banner lives or dies by. An unmarked dish on a draft menu is a task; one a
   * parent can order is a defect. A banner that cannot tell them apart reads as noise by week two.
   */
  it('ignores a dish that is on no live menu', () => {
    expect(
      dishesBlockingOrders([menuRow(null)], [dish({ id: 'd-1', foodType: null })]).count,
    ).toBe(0);
  });

  it('ignores a dish switched off on the menu, and one retired from the catalogue', () => {
    expect(
      dishesBlockingOrders(
        [menuRow({ items: [{ dishId: 'd-1', isActive: false }, { dishId: 'd-2', isActive: true }] })],
        [dish({ id: 'd-1', foodType: null }), dish({ id: 'd-2', foodType: null, isActive: false })],
      ).count,
    ).toBe(0);
  });

  it('counts one dish once, however many schools serve it', () => {
    const found = dishesBlockingOrders(
      [
        menuRow({ items: [{ dishId: 'd-1', isActive: true }] }, 'Amity'),
        menuRow({ items: [{ dishId: 'd-1', isActive: true }] }, 'Gem'),
      ],
      [dish({ id: 'd-1', foodType: null })],
    );
    // One thing to fix, in two places to notice it.
    expect(found.count).toBe(1);
    expect(found.schools).toEqual(['Amity', 'Gem']);
  });

  it('says nothing when every live dish is marked', () => {
    expect(
      dishesBlockingOrders(
        [menuRow({ items: [{ dishId: 'd-1', isActive: true }] })],
        [dish({ id: 'd-1', foodType: 'non_veg' })],
      ),
    ).toEqual({ count: 0, names: [], schools: [] });
  });
});

describe('attention', () => {
  const school = (name: string, blockers: string[], gaps: string[] = []): SchoolReadiness =>
    ({
      school: { id: `s-${name}`, name },
      gates: [
        ...blockers.map((detail) => ({
          key: 'breaks', label: 'Break windows', state: 'missing', detail,
          fix: { label: 'Set break windows', href: '/admin/config' }, blocking: true,
        })),
        ...gaps.map((detail) => ({
          key: 'contact', label: 'Report contact', state: 'missing', detail,
          fix: null, blocking: false,
        })),
      ],
      state: blockers.length ? 'incomplete' : 'live',
      blockers: blockers.map((detail) => ({
        key: 'breaks', label: 'Break windows', state: 'missing', detail,
        fix: { label: 'Set break windows', href: '/admin/config' }, blocking: true,
      })),
    }) as unknown as SchoolReadiness;

  const noDishes = { count: 0, names: [], schools: [] };

  it('says what the problem stops, not what is missing', () => {
    const [item] = attention([school('Gem', ['no break windows'])], noDishes);
    expect(item!.text).toContain('cannot take an order');
    expect(item!.fix).toEqual({ label: 'Set break windows', href: '/admin/config' });
  });

  it('names one blocker and counts the rest rather than listing five', () => {
    const [item] = attention([school('Gem', ['no break windows', 'no menu', 'no service days'])], noDishes);
    expect(item!.text).toContain('no break windows');
    expect(item!.text).toContain('and 2 more');
  });

  /*
   * A missing report email must not sit at the same weight as a school that cannot trade. That
   * ordering is the difference between a list somebody works through and a list somebody skims.
   */
  it('puts everything blocking above everything merely missing', () => {
    const items = attention(
      [school('Amity', [], ['no report contact']), school('Gem', ['no break windows'])],
      { count: 2, names: ['A', 'B'], schools: ['Amity'] },
    );
    expect(items.map((i) => i.key)).toEqual([
      'school:s-Gem', 'dishes:food-type', 'gap:s-Amity:contact',
    ]);
  });

  it('is empty when nothing needs anybody', () => {
    expect(attention([school('Amity', [])], noDishes)).toEqual([]);
  });

  it('pluralises the dish line, because "1 dishes have" is how a screen loses trust', () => {
    const [one] = attention([], { count: 1, names: ['A'], schools: [] });
    expect(one!.text).toContain('1 dish on a live menu has');
    const [many] = attention([], { count: 3, names: ['A'], schools: [] });
    expect(many!.text).toContain('3 dishes on a live menu have');
  });
});

describe('boardRows', () => {
  it('joins the money read onto the kitchen read by order id', () => {
    const [row] = boardRows([kitchenOrder({ id: 'x' })], [adminOrder({ id: 'x', totalPaise: 12_300 })]);
    expect(row!.totalPaise).toBe(12_300);
  });

  it('sums the line quantities rather than counting lines', () => {
    const [row] = boardRows(
      [kitchenOrder({ lines: [
        { dishId: 'd-1', dishName: 'Wrap', quantity: 2, note: null },
        { dishId: 'd-2', dishName: 'Coffee', quantity: 1, note: null },
      ] })],
      null,
    );
    expect(row!.items).toBe(3);
  });

  /*
   * The property this whole file is careful about. Zero is a real total — a pack-paid meal is
   * genuinely ₹0 — so "may not see money" must be a different value from "cost nothing", or the
   * screen tells a kitchen porter that today was free.
   */
  it('is null, never zero, for an account that may not see money', () => {
    const [row] = boardRows([kitchenOrder()], null);
    expect(row!.totalPaise).toBeNull();
  });

  it('is null for an order the money read did not return, even when it returned others', () => {
    // RLS scopes the two reads independently. An order present in one and absent from the other is
    // a real state, and guessing zero for it would be inventing a number.
    const rows = boardRows(
      [kitchenOrder({ id: 'a' }), kitchenOrder({ id: 'b' })],
      [adminOrder({ id: 'a', totalPaise: 500 })],
    );
    expect(rows.map((r) => r.totalPaise)).toEqual([500, null]);
  });
});

describe('sortBoard', () => {
  it('is school, then break, then class — the order somebody works a day', () => {
    const rows = boardRows(
      [
        kitchenOrder({ id: '1', schoolName: 'Gem', breakLabel: 'First', classLabel: '2' }),
        kitchenOrder({ id: '2', schoolName: 'Amity', breakLabel: 'Second', classLabel: '1' }),
        kitchenOrder({ id: '3', schoolName: 'Amity', breakLabel: 'First', classLabel: '9' }),
      ],
      null,
    );
    expect(sortBoard(rows).map((r) => r.id)).toEqual(['3', '2', '1']);
  });

  it('does not reorder as orders are marked delivered', () => {
    // Sorting by status would move a row the moment somebody hands food over, which is precisely
    // when they are looking at it.
    const rows = boardRows(
      [
        kitchenOrder({ id: '1', status: 'delivered', recipientName: 'Aa' }),
        kitchenOrder({ id: '2', status: 'paid', recipientName: 'Bb' }),
      ],
      null,
    );
    expect(sortBoard(rows).map((r) => r.id)).toEqual(['1', '2']);
  });

  it('does not mutate its input', () => {
    const rows = boardRows([kitchenOrder({ id: 'z', schoolName: 'Z' }), kitchenOrder({ id: 'a', schoolName: 'A' })], null);
    const before = rows.map((r) => r.id);
    sortBoard(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('sortBoard — an unlabelled break', () => {
  /*
   * Empty string sorts before every real label, which would put the one row nobody can place at
   * the top of the list. A school with a single service legitimately has no break to name.
   */
  it('sorts a row with no break last within its school, not first', () => {
    const rows = boardRows(
      [
        kitchenOrder({ id: 'none', schoolName: 'Gem', breakLabel: null, recipientName: 'A' }),
        kitchenOrder({ id: 'first', schoolName: 'Gem', breakLabel: 'First break', recipientName: 'B' }),
        kitchenOrder({ id: 'second', schoolName: 'Gem', breakLabel: 'Second break', recipientName: 'C' }),
      ],
      null,
    );
    expect(sortBoard(rows).map((r) => r.id)).toEqual(['first', 'second', 'none']);
  });

  it('does the same for an unlabelled class', () => {
    const rows = boardRows(
      [
        kitchenOrder({ id: 'none', classLabel: null, recipientName: 'A' }),
        kitchenOrder({ id: 'four', classLabel: '4', recipientName: 'B' }),
      ],
      null,
    );
    expect(sortBoard(rows).map((r) => r.id)).toEqual(['four', 'none']);
  });
});

/**
 * A status page somebody can open without a session — `E10-67`.
 *
 * Shaped so every state the page has to render is on screen at once, because a morning where
 * nothing is wrong demonstrates none of what this screen exists for:
 *
 *   - **dishes blocking orders**, so the banner is reachable
 *   - a school that **cannot take an order**, and a separate one merely missing its report contact,
 *     so the ordering of "Needs you" is visible
 *   - a **cancelled** order and a **partly refunded** one, so the revenue arithmetic is exercised
 *   - a **delivered** order beside a paid one, so the board shows both marks
 *
 * Names are invented and obviously so. Real children's names are Tier P and never appear in a
 * fixture, a screenshot, or anything committed (non-negotiable #4).
 */
import type { api } from '@graybag/shared';

import type { AttentionItem, BlockingDishes, BoardRow, OrdersToday, PacksToday, RevenueToday } from './today.js';

export const TODAY_FIXTURE: {
  date: string;
  blocking: BlockingDishes;
  orders: OrdersToday;
  revenue: RevenueToday;
  packs: PacksToday;
  attention: AttentionItem[];
  board: BoardRow[];
} = {
  date: '2026-08-28',

  blocking: {
    count: 3,
    names: ['Aloo Paratha', 'Mixed Fried Rice', 'Schezwan Noodles'],
    schools: ['Amity International, Mohali'],
  },

  orders: {
    total: 5,
    byStatus: { paid: 3, delivered: 1, cancelled: 1 },
    cancelled: 1,
  },

  revenue: {
    // Four live orders; the cancelled one is not in gross.
    grossPaise: 85_050,
    refundedPaise: 6_000,
    netPaise: 79_050,
    cancelled: 1,
  },

  packs: {
    packsSold: 17,
    collectedPaise: 5_120_000,
    mealsSold: 170,
    liveOffers: 2,
  },

  attention: [
    {
      key: 'school:s-2',
      text: 'Gem Public School cannot take an order — no break windows, and 1 more',
      fix: { label: 'Set break windows', href: '/admin/config' },
    },
    {
      key: 'dishes:food-type',
      text:
        '3 dishes on a live menu have no veg or non-veg marking, so a parent cannot tell what ' +
        'they are ordering',
      fix: { label: 'Fix in Dishes', href: '/admin/dishes?type=unset' },
    },
    {
      key: 'gap:s-1:contact',
      text: 'Amity International, Mohali — no report contact, so the monthly report goes nowhere',
      fix: { label: 'Add a contact', href: '/admin/schools' },
    },
  ],

  board: [
    {
      id: 'o-1', recipientName: 'Demo Child One', classLabel: '4',
      schoolName: 'Amity International, Mohali', breakLabel: 'First break',
      items: 2, status: 'delivered', totalPaise: 18_900,
    },
    {
      id: 'o-2', recipientName: 'Demo Child Two', classLabel: '6',
      schoolName: 'Amity International, Mohali', breakLabel: 'First break',
      items: 3, status: 'paid', totalPaise: 25_200,
    },
    {
      id: 'o-3', recipientName: 'Demo Child Three', classLabel: '2',
      schoolName: 'Amity International, Mohali', breakLabel: 'Second break',
      items: 2, status: 'paid', totalPaise: 18_900,
    },
    {
      id: 'o-4', recipientName: 'Demo Child Four', classLabel: '3',
      schoolName: 'Gem Public School', breakLabel: 'First break',
      items: 1, status: 'cancelled', totalPaise: 12_600,
    },
    {
      id: 'o-5', recipientName: 'Demo Child Five', classLabel: '5',
      schoolName: 'Gem Public School', breakLabel: null,
      items: 2, status: 'paid', totalPaise: 22_050,
    },
  ],
};

/** The grants the demo view pretends to hold — every panel visible, which is what a11y walks. */
export const TODAY_FIXTURE_GRANTS: string[] = [
  'orders.view', 'orders.view_financials', 'menu.edit', 'school.edit', 'meal_packs.manage',
];

export type TodayFixture = typeof TODAY_FIXTURE;
export type { api };

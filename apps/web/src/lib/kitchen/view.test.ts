import { describe, expect, it } from 'vitest';

import { FULL_PERMISSIONS, fixtureDay, fixtureTransport } from './fixture.js';
import type { KitchenFilters, KitchenOrder } from './types.js';
import {
  allowedActions,
  applyFilters,
  boardState,
  countLine,
  describeDate,
  filterOptions,
  groupByClass,
  groupProgress,
  groupState,
  productionTotals,
  relativeDay,
  shiftDate,
  summarise,
} from './view.js';

const DATE = '2026-08-13';
const day = fixtureDay(DATE);

const filters = (over: Partial<KitchenFilters> = {}): KitchenFilters => ({
  serviceDate: DATE,
  schoolId: null,
  breakId: null,
  status: null,
  ...over,
});

/** A minimal order, so a test can state exactly the one thing it is about. */
const order = (over: Partial<KitchenOrder> = {}): KitchenOrder => ({
  id: 'o1',
  orderRef: 'REF',
  schoolId: 's1',
  schoolName: 'Alpha Public School',
  breakId: 'b1',
  breakLabel: 'Morning break',
  recipientName: 'Aarav Sharma',
  classLabel: '5',
  sectionLabel: 'A',
  status: 'paid',
  pickupCode: null,
  lines: [{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 1, note: null }],
  ...over,
});

describe('allowedActions', () => {
  it('lets a paid order be started, delivered or cancelled', () => {
    expect(allowedActions('paid')).toEqual(['preparing', 'delivered', 'cancelled']);
  });

  it('will not send a preparing order backwards to paid', () => {
    // §4.1 has no `preparing -> paid`. A button the server would refuse must never be drawn.
    expect(allowedActions('preparing')).toEqual(['delivered', 'cancelled']);
  });

  it('offers nothing on a delivered order, because delivered is terminal', () => {
    expect(allowedActions('delivered')).toEqual([]);
  });

  it('offers nothing on a cancelled order', () => {
    expect(allowedActions('cancelled')).toEqual([]);
  });
});

describe('allowedActions with grants — E09-09, the permission split', () => {
  const porter = { viewOrders: true, markDelivered: true, cancelOrders: false };
  const observer = { viewOrders: true, markDelivered: false, cancelOrders: false };

  it('lets a porter hand food over but not cancel', () => {
    // `orders.cancel` triggers a refund, which is why it is a separate grant (D3). A screen
    // that draws both sets of buttons for both people makes the split mean nothing.
    expect(allowedActions('paid', porter)).toEqual(['preparing', 'delivered']);
  });

  it('offers an observer nothing, even on an actionable order', () => {
    expect(allowedActions('paid', observer)).toEqual([]);
  });

  it('still respects the lifecycle — grants cannot resurrect a delivered order', () => {
    // Two independent gates. Holding every permission does not make `delivered -> paid` legal.
    expect(allowedActions('delivered', FULL_PERMISSIONS)).toEqual([]);
  });

  it('falls back to the lifecycle when grants are unknown', () => {
    expect(allowedActions('paid')).toEqual(['preparing', 'delivered', 'cancelled']);
  });
});

describe('groupByClass', () => {
  it('groups by school, break and class together', () => {
    const groups = groupByClass([
      order({ id: 'a', classLabel: '5', sectionLabel: 'A' }),
      order({ id: 'b', classLabel: '5', sectionLabel: 'A' }),
      order({ id: 'c', classLabel: '5', sectionLabel: 'B' }),
      order({ id: 'd', classLabel: '5', sectionLabel: 'A', breakId: 'b2', breakLabel: 'Lunch break' }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.classLabel === '5-A' && g.breakLabel === 'Morning break')?.orders).toHaveLength(2);
  });

  it('sorts classes numerically, so 10 comes after 9', () => {
    const groups = groupByClass([
      order({ id: 'a', classLabel: '10', sectionLabel: 'A' }),
      order({ id: 'b', classLabel: '9', sectionLabel: 'A' }),
    ]);
    expect(groups.map((g) => g.classLabel)).toEqual(['9-A', '10-A']);
  });

  it('handles an order with no class', () => {
    const groups = groupByClass([order({ classLabel: null, sectionLabel: null })]);
    expect(groups[0]?.classLabel).toBe('No class');
  });

  describe('the counts, which are the thing the kitchen reads', () => {
    const group = () =>
      groupByClass([
        order({ id: 'a', status: 'delivered' }),
        order({ id: 'b', status: 'delivered' }),
        order({ id: 'c', status: 'paid' }),
        order({ id: 'd', status: 'preparing' }),
        order({ id: 'e', status: 'cancelled' }),
      ])[0]!;

    it('excludes cancelled orders from the denominator', () => {
      // A cancelled lunch is not an undelivered one. Counting it either way makes the progress
      // line wrong in one direction or the other.
      expect(group().deliverable).toBe(4);
      expect(group().delivered).toBe(2);
      expect(groupProgress(group())).toBe('2 of 4 delivered');
    });

    it('offers "mark all" only the orders that are actually outstanding', () => {
      expect(group().outstandingIds.sort()).toEqual(['c', 'd']);
    });

    it('never re-marks something already delivered', () => {
      expect(group().outstandingIds).not.toContain('a');
    });

    it('never marks a cancelled order delivered', () => {
      expect(group().outstandingIds).not.toContain('e');
    });
  });
});

describe('groupState and groupProgress', () => {
  const build = (statuses: KitchenOrder['status'][]) =>
    groupByClass(statuses.map((status, i) => order({ id: `o${i}`, status })))[0]!;

  it('is "none" when nothing has gone out', () => {
    expect(groupState(build(['paid', 'preparing']))).toBe('none');
    expect(groupProgress(build(['paid', 'preparing']))).toBe('0 of 2 delivered');
  });

  it('is "partial" in between — its own state, not an inference from a colour', () => {
    expect(groupState(build(['delivered', 'paid']))).toBe('partial');
    expect(groupProgress(build(['delivered', 'paid']))).toBe('1 of 2 delivered');
  });

  it('is "all" when the tray is done', () => {
    expect(groupState(build(['delivered', 'delivered']))).toBe('all');
    expect(groupProgress(build(['delivered', 'delivered']))).toBe('All 2 delivered');
  });

  it('is "empty" when every order was cancelled, and says so rather than "0 of 0"', () => {
    expect(groupState(build(['cancelled']))).toBe('empty');
    expect(groupProgress(build(['cancelled']))).toBe('Nothing to hand over');
  });
});

describe('productionTotals', () => {
  it('sums quantities per dish, biggest batch first', () => {
    const totals = productionTotals([
      order({ id: 'a', lines: [{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 2, note: null }] }),
      order({ id: 'b', lines: [{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 1, note: null }] }),
      order({ id: 'c', lines: [{ dishId: 'd2', dishName: 'Paneer Wrap', quantity: 1, note: null }] }),
    ]);
    expect(totals).toEqual([
      { dishId: 'd1', dishName: 'Veg Sandwich', quantity: 3 },
      { dishId: 'd2', dishName: 'Paneer Wrap', quantity: 1 },
    ]);
  });

  it('sorts alphabetically within a tie, so the list is stable between renders', () => {
    const totals = productionTotals([
      order({ id: 'a', lines: [{ dishId: 'd2', dishName: 'Zebra dish', quantity: 1, note: null }] }),
      order({ id: 'b', lines: [{ dishId: 'd1', dishName: 'Apple dish', quantity: 1, note: null }] }),
    ]);
    expect(totals.map((t) => t.dishName)).toEqual(['Apple dish', 'Zebra dish']);
  });

  it('excludes cancelled orders — cooking against one wastes food', () => {
    const totals = productionTotals([
      order({ id: 'a', status: 'cancelled', lines: [{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 5, note: null }] }),
      order({ id: 'b', lines: [{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 1, note: null }] }),
    ]);
    expect(totals).toEqual([{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 1 }]);
  });

  it('still counts a delivered order, because it was cooked', () => {
    const totals = productionTotals([
      order({ id: 'a', status: 'delivered', lines: [{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 3, note: null }] }),
    ]);
    expect(totals[0]?.quantity).toBe(3);
  });

  it('answers for the filtered set, which is the point of folding Cook into this screen', () => {
    const morning = applyFilters(day.orders, filters({ breakId: day.breaks[0]!.id }));
    const all = productionTotals(day.orders).reduce((n, t) => n + t.quantity, 0);
    const justMorning = productionTotals(morning).reduce((n, t) => n + t.quantity, 0);
    expect(justMorning).toBeGreaterThan(0);
    expect(justMorning).toBeLessThan(all);
  });
});

describe('applyFilters', () => {
  it('returns everything when nothing is set', () => {
    expect(applyFilters(day.orders, filters())).toHaveLength(day.orders.length);
  });

  it('filters by break', () => {
    const morning = applyFilters(day.orders, filters({ breakId: day.breaks[0]!.id }));
    expect(morning.every((o) => o.breakId === day.breaks[0]!.id)).toBe(true);
  });

  it('filters by status', () => {
    const delivered = applyFilters(day.orders, filters({ status: 'delivered' }));
    expect(delivered.every((o) => o.status === 'delivered')).toBe(true);
    expect(delivered.length).toBeGreaterThan(0);
  });

  it('combines filters as AND', () => {
    const both = applyFilters(day.orders, filters({ breakId: day.breaks[0]!.id, status: 'paid' }));
    expect(both.every((o) => o.breakId === day.breaks[0]!.id && o.status === 'paid')).toBe(true);
  });
});

describe('summarise', () => {
  it('counts orders, items, and each state of the day', () => {
    const s = summarise(day.orders);
    expect(s.orders).toBe(24);
    expect(s.delivered).toBe(4);
    expect(s.cancelled).toBe(1);
    expect(s.outstanding).toBe(19);
    expect(s.orders).toBe(s.delivered + s.outstanding + s.cancelled);
  });

  it('excludes cancelled orders from the item count', () => {
    const s = summarise([
      order({ id: 'a', lines: [{ dishId: 'd1', dishName: 'x', quantity: 2, note: null }] }),
      order({ id: 'b', status: 'cancelled', lines: [{ dishId: 'd1', dishName: 'x', quantity: 9, note: null }] }),
    ]);
    expect(s.items).toBe(2);
  });
});

describe('boardState — emptiness is four different things (ux-spec §5.21)', () => {
  const base = { day, filters: filters(), loading: false, offline: false, error: null };

  it('is loading before anything has arrived', () => {
    expect(boardState({ ...base, day: null, loading: true }).kind).toBe('loading');
  });

  it('distinguishes "nobody ordered" from "your filter matched nothing"', () => {
    const emptyDay = { ...day, orders: [] };
    expect(boardState({ ...base, day: emptyDay }).kind).toBe('empty-day');
    expect(boardState({ ...base, filters: filters({ status: 'cancelled', breakId: 'nope' }) }).kind)
      .toBe('empty-filter');
  });

  it('reports unreachable rather than showing an empty kitchen', () => {
    // The failure that matters at 7am: an empty list because the request failed looks exactly
    // like an empty list because nobody ordered, and they have opposite responses.
    const state = boardState({ ...base, day: null, error: 'Network request failed' });
    expect(state.kind).toBe('unreachable');
    expect(state.kind === 'unreachable' && state.message).toBe('Network request failed');
  });

  it('is forbidden — not empty — when the account cannot view orders', () => {
    // §5.21 N3 must never render as N1. An operator without `orders.view` seeing an empty list
    // reads it as "nobody ordered today", and the response to that is that nobody cooks.
    const denied = fixtureDay(DATE, undefined, { viewOrders: false, markDelivered: false, cancelOrders: false });
    expect(boardState({ ...base, day: denied }).kind).toBe('forbidden');
  });

  it('reports forbidden even when there would have been orders to show', () => {
    const denied = fixtureDay(DATE, undefined, { viewOrders: false, markDelivered: true, cancelOrders: true });
    expect(denied.orders.length).toBeGreaterThan(0);
    expect(boardState({ ...base, day: denied }).kind).toBe('forbidden');
  });

  it('keeps showing the last list when offline, and carries when it was read', () => {
    const state = boardState({ ...base, offline: true });
    expect(state.kind).toBe('stale');
    expect(state.kind === 'stale' && state.loadedAt).toBe(day.loadedAt);
    expect(state.kind === 'stale' && state.groups.length).toBeGreaterThan(0);
  });

  it('prefers showing stale data over showing nothing', () => {
    const state = boardState({ ...base, offline: true, error: 'offline' });
    expect(state.kind).toBe('stale');
  });
});

describe('the fixture transport', () => {
  it('applies a status change', async () => {
    const transport = fixtureTransport(DATE);
    const before = await transport.load(filters());
    const target = before.orders.find((o) => o.status === 'paid')!;
    await transport.updateStatus({ orderIds: [target.id], to: 'delivered' });
    const after = await transport.load(filters());
    expect(after.orders.find((o) => o.id === target.id)?.status).toBe('delivered');
  });

  it('can be made to fail, so the failure path is reachable in review', async () => {
    // The state nobody builds a way to see. A write that silently does nothing is the worst
    // thing this screen can do, so the fixture has to be able to produce it on demand.
    const transport = fixtureTransport(DATE);
    transport.failNext();
    await expect(transport.updateStatus({ orderIds: ['x'], to: 'delivered' })).rejects.toThrow();
  });

  it('recovers after one failure rather than staying broken', async () => {
    const transport = fixtureTransport(DATE);
    transport.failNext();
    await transport.updateStatus({ orderIds: ['x'], to: 'delivered' }).catch(() => {});
    await expect(transport.updateStatus({ orderIds: ['x'], to: 'delivered' })).resolves.toBeDefined();
  });
});

describe('filterOptions — an inert control is worse than none', () => {
  const day = (schools: string[], breaks: string[]) => ({
    ...fixtureDay(DATE),
    schools: schools.map((s) => ({ id: s, name: s })),
    breaks: breaks.map((b) => ({ id: b, label: b })),
  });

  it('hides the school filter when only one school is in scope', () => {
    // A dropdown whose every option returns the same list takes the same room as a real
    // control, invites the same tap, and teaches the operator that controls here do nothing.
    expect(filterOptions(day(['Alpha'], ['am', 'pm'])).showSchools).toBe(false);
  });

  it('shows the school filter when there is a choice to make', () => {
    expect(filterOptions(day(['Alpha', 'Bravo'], ['am'])).showSchools).toBe(true);
  });

  it('hides the break filter for a school with one break', () => {
    expect(filterOptions(day(['Alpha'], ['am'])).showBreaks).toBe(false);
  });

  it('hides both when there is nothing loaded at all', () => {
    const options = filterOptions(null);
    expect(options.showSchools).toBe(false);
    expect(options.showBreaks).toBe(false);
  });
});

describe('countLine — does today look right', () => {
  it('counts orders, classes and breaks over what is visible', () => {
    const orders = applyFilters(day.orders, filters());
    expect(countLine(orders, groupByClass(orders))).toBe('24 orders · 3 classes · 2 breaks');
  });

  it('agrees with the list underneath once a filter is applied', () => {
    const f = filters({ breakId: day.breaks[0]!.id });
    const orders = applyFilters(day.orders, f);
    expect(countLine(orders, groupByClass(orders))).toContain('1 break');
  });

  it('says so plainly when there is nothing', () => {
    expect(countLine([], [])).toBe('No orders');
  });

  it('singularises rather than printing "1 orders"', () => {
    const one = [order()];
    expect(countLine(one, groupByClass(one))).toBe('1 order · 1 class · 1 break');
  });

  it('omits breaks entirely for a school that has none', () => {
    // `break_label_snapshot` is nullable. "1 break" for a school with none is an invented fact.
    const none = [order({ breakId: null, breakLabel: null })];
    expect(countLine(none, groupByClass(none))).toBe('1 order · 1 class');
  });
});

describe('the date, as a kitchen reads it', () => {
  it('names today, tomorrow and yesterday', () => {
    expect(relativeDay('2026-08-13', '2026-08-13')).toBe('Today');
    expect(relativeDay('2026-08-14', '2026-08-13')).toBe('Tomorrow');
    expect(relativeDay('2026-08-12', '2026-08-13')).toBe('Yesterday');
  });

  it('returns null for a date that is none of them', () => {
    expect(relativeDay('2026-08-20', '2026-08-13')).toBeNull();
  });

  it('leads with the weekday, which answers "is this today" faster than a number', () => {
    expect(describeDate('2026-08-13', '2026-08-13')).toBe('Today · Thursday 13 August');
    expect(describeDate('2026-08-20', '2026-08-13')).toBe('Thursday 20 August');
  });

  it('shifts across a month boundary', () => {
    expect(shiftDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31');
  });
});

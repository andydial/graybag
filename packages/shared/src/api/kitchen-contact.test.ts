import { afterEach, describe, expect, it } from 'vitest';

import {
  KITCHEN_CONTACT_COLUMNS,
  KITCHEN_ORDER_COLUMNS,
  fetchKitchenOrderContacts,
  setApiTransport,
} from './index.js';
import { fakeTransport } from './test-support.js';

/**
 * The email of the parent who placed each order, for the kitchen — `E09-46`.
 *
 * Andy, 2026-09-18, as an emergency: *"For each order — we need email of the user that placed the
 * order shown in kitchen."*
 *
 * ## Why this is a separate read, asserted here rather than assumed
 *
 * `app_user` has two read policies: `app_user_read_self`, and `app_user_read_admin` gated on
 * `auth_can_platform('users.view')` — which is held by **Super Admin only**. Kitchen jobs hold
 * `orders.view`, `orders.view_pii` and `orders.mark_delivered`. So an `app_user(email)` embed on
 * the order query would return the address to Andy, the person checking it, and nothing at all to
 * the kitchen staff who asked for it.
 *
 * `0095` answers that with a definer view scoped on `orders.view_pii` at the order's school or the
 * kitchen serving it — the reach the board already has for that child's name and allergens.
 */

afterEach(() => setApiTransport(null));

const install = (rows: unknown, error: { message: string; code?: string } | null = null) => {
  const fake = fakeTransport(rows, error);
  setApiTransport(fake.transport);
  return fake;
};

describe('the order query is UNCHANGED', () => {
  it('still reads no customer identity, so the existing guarantee still means what it says', () => {
    /*
     * The point of doing this as a second read. `KITCHEN_ORDER_COLUMNS` is the redaction that
     * keeps a kitchen porter away from every parent record, and widening it to carry an email
     * would have put the parent back on the row for everyone reading it, permission or not.
     */
    expect(KITCHEN_ORDER_COLUMNS).not.toContain('customer_user_id');
    expect(KITCHEN_ORDER_COLUMNS).not.toContain('email');
    expect(KITCHEN_ORDER_COLUMNS).not.toContain('app_user');
  });
});

describe('the contact read', () => {
  it('takes two columns and nothing else', () => {
    /*
     * The view could have carried the phone, both names, or the parent's id. A policy on
     * `app_user` could not have prevented any of that — RLS filters rows, never columns — which
     * is the whole argument for the view existing. This is the client half of that promise.
     */
    expect(KITCHEN_CONTACT_COLUMNS).toBe('order_id,customer_email');
  });

  it('reads the definer view, never app_user', async () => {
    const fake = install([]);
    await fetchKitchenOrderContacts(['o1']);
    expect(fake.queries[0]?.table).toBe('kitchen_order_contact');
    expect(fake.queries[0]?.columns).toBe(KITCHEN_CONTACT_COLUMNS);
  });

  it('asks only for the orders on screen', async () => {
    // Bounded by the board's own list rather than fetching every contact for the day.
    const fake = install([]);
    await fetchKitchenOrderContacts(['o1', 'o2']);
    // `inFilters`, not `filters`: `in()` is a different SQL operator and the fake records it
    // separately so a test asserting one cannot pass on the other.
    expect(fake.queries[0]?.inFilters).toContainEqual({ column: 'order_id', values: ['o1', 'o2'] });
  });

  it('does not call the server at all for an empty board', async () => {
    const fake = install([]);
    expect(await fetchKitchenOrderContacts([])).toEqual({});
    expect(fake.queries).toEqual([]);
  });

  it('maps order id to email', async () => {
    install([
      { order_id: 'o1', customer_email: 'parent@example.com' },
      { order_id: 'o2', customer_email: 'other@example.com' },
    ]);
    expect(await fetchKitchenOrderContacts(['o1', 'o2'])).toEqual({
      o1: 'parent@example.com',
      o2: 'other@example.com',
    });
  });

  it('drops a row with no email rather than mapping an empty string', async () => {
    // An empty address would render as a `mailto:` link to nowhere, which is worse than the
    // honest "not shown" the screen falls back to.
    install([{ order_id: 'o1', customer_email: '' }, { order_id: 'o2', customer_email: null }]);
    expect(await fetchKitchenOrderContacts(['o1', 'o2'])).toEqual({});
  });
});

describe('it is allowed to fail, and that is the design', () => {
  it('returns nothing rather than throwing when the read is refused', async () => {
    /*
     * An account without `orders.view_pii` reads nothing here. That is correct, not an error, and
     * it must not take the order list with it — a kitchen with no board at 7am is the worst
     * outcome this screen has, and nobody cooks from an email address.
     */
    install(null, { message: 'permission denied', code: '42501' });
    expect(await fetchKitchenOrderContacts(['o1'])).toEqual({});
  });

  it('returns nothing when the view does not exist yet', async () => {
    // The deploy order is migration first, then the app — but the reverse must degrade rather
    // than break, because the board is live while it happens.
    install(null, { message: 'relation "kitchen_order_contact" does not exist', code: '42P01' });
    expect(await fetchKitchenOrderContacts(['o1'])).toEqual({});
  });
});

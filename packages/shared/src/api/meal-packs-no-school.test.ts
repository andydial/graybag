import { afterEach, describe, expect, it } from 'vitest';

import * as mealPacks from './meal-packs.js';
import { setApiTransport } from './client.js';

/**
 * A parent at a school with packs switched off cannot reach a buy path **by any route** — `E21`.
 *
 * Andy, 2026-09-16: *"a test asserting a parent with no enabled school sees no pack surface and
 * cannot reach a buy path by any route — not just that the section is hidden."*
 *
 * ## What this file adds, and what it deliberately does not repeat
 *
 * `meal-packs.test.ts` already covers the **surface** thoroughly — the three cases of
 * `meal_pack_surface`, its fail-closed behaviour, malformed answers, and a balance surviving a
 * school being switched off. None of that is restated here; duplicated assertions are noise that
 * makes a suite look stronger than it is.
 *
 * Two things nothing asserted:
 *
 *   1. **The purchase call itself refuses loudly.** Every other test stops at reading offers.
 *   2. **"By any route" as a structural property.** Every existing test names a function. That
 *      catches today's routes and is blind to tomorrow's — and the failure being guarded against
 *      is somebody adding a fourth entry point that skips the surface check. So this enumerates
 *      the module's own exports and fails when an unreviewed one appears.
 *
 * ## The honest limit
 *
 * A stub transport says whatever it is told to, so this proves the **client honours a refusal**,
 * not that the refusal exists. The database half — no `meal_pack_offer_school` row ⇒
 * `meal_pack_offers_for_school` returns nothing ⇒ `start_meal_pack_purchase` raises — is pgTAP
 * against the rebuilt schema and is recorded as a requirement in `planning/andy-queue.md`. Saying
 * this file proves the whole property would be the mistake `meal_packs.test.sql` made: asserting
 * the half that was easy to reach and reading it as the whole.
 */

afterEach(() => setApiTransport(null));

/** A transport that refuses everything, the way a school with no enabled offer does. */
function refuseEverything() {
  setApiTransport({
    from: () => { throw new Error('This test should not touch a table.'); },
    rpc: async () => ({ data: null, error: { message: 'not offered at this school', code: 'P0001' } }),
    functions: {
      invoke: async () => ({
        data: null, error: { message: 'not offered at this school', code: 'P0001' },
      }),
    },
  } as never);
}

describe('the purchase call', () => {
  it('throws rather than resolving quietly when the school does not sell packs', async () => {
    /*
     * Deliberately the opposite rule from `fetchMealPackSurface`, and the asymmetry is the point.
     * The surface swallows failure because rendering nothing costs a sale the parent can make
     * next time. By the time somebody is *buying*, silence looks like success — and a parent who
     * believes they bought a pack they did not is a support call and a trust problem, not a lost
     * sale.
     */
    refuseEverything();
    await expect(mealPacks.startMealPackPurchase({
      schoolId: '99999999-8888-4777-8666-555555555555',
      offerId: '11111111-2222-4333-8444-555555555555',
      idempotencyKey: 'k-1',
    })).rejects.toThrow();
  });

  it('refuses before it reaches the network when the idempotency key is empty', async () => {
    // A retry without a stable key is a second pack and a second charge. Caught client-side
    // because by the time the server sees two calls it cannot tell them apart.
    refuseEverything();
    await expect(mealPacks.startMealPackPurchase({
      schoolId: '99999999-8888-4777-8666-555555555555',
      offerId: '11111111-2222-4333-8444-555555555555',
      idempotencyKey: '   ',
    })).rejects.toThrow(/idempotency key/i);
  });
});

describe('by any route — the structural half', () => {
  /**
   * Every exported function that could put a pack in a parent's hands or spend one.
   *
   * Reviewed by hand, and the test below fails when the module grows an export that is not in
   * either list. That is the point: a new buy path is exactly the change that would slip past a
   * suite naming only today's functions, and the person adding it has to decide which list it
   * belongs in.
   */
  const BUY_OR_SPEND = [
    'startMealPackPurchase',
    // `confirmMealPackPlan` was here and is GONE with the planner (`E21-73`). Spending a balance
    // is no longer a write of its own: it happens inside `checkout`, against the order lines as
    // persisted, so there is one write on the redemption path rather than two.
  ];

  /** Reads. Safe to reach with packs off — they answer "nothing", which is the correct answer. */
  const READS = [
    'fetchMealPackSurface',
    'fetchMealPackOffers',
    'fetchMealPackBalances',
    /**
     * `packThisOrderDrawsFrom` is neither a read nor a write — it is a PURE SELECTOR over a list
     * the caller already has, and it touches no transport at all. Classified with the reads
     * because that is where it is harmless: given an empty list it returns `null`, which is the
     * correct answer with packs off and the only answer it can give.
     *
     * It exists so the cart and the balance screen cannot name different packs. A second query
     * would have been the alternative, and two queries are two chances to disagree.
     */
    'packThisOrderDrawsFrom',
  ];

  it('has no exported entry point that is neither a reviewed read nor a reviewed write', () => {
    const exported = Object.keys(mealPacks)
      .filter((k) => typeof (mealPacks as Record<string, unknown>)[k] === 'function');
    const unreviewed = exported.filter((k) => !BUY_OR_SPEND.includes(k) && !READS.includes(k));
    expect(unreviewed, 'new pack entry point — add it to BUY_OR_SPEND or READS and test it').toEqual([]);
  });

  it('refuses every write route when the school does not sell packs', async () => {
    /*
     * Each write, refused, in one loop — so adding a route to `BUY_OR_SPEND` without making it
     * fail-closed breaks this immediately rather than at the next audit.
     */
    refuseEverything();
    for (const name of BUY_OR_SPEND) {
      const fn = (mealPacks as unknown as Record<string, (...a: never[]) => Promise<unknown>>)[name]!;
      await expect(
        Promise.resolve().then(() => fn({
          schoolId: '99999999-8888-4777-8666-555555555555',
          offerId: '11111111-2222-4333-8444-555555555555',
          idempotencyKey: 'k-1',
          days: [],
          correlationId: '11111111-2222-4333-8444-555555555555',
        } as never)),
        name,
      ).rejects.toThrow();
    }
  });
});

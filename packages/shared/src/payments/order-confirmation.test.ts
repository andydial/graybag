import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `E21-93`. **A send that is never attempted must still leave a row.**
 *
 * Andy bought a pack on staging, the money moved, settlement completed, the invoice was issued —
 * and no email arrived. `notification_delivery` held **nothing at all** for that purchase: not
 * `failed`, not `suppressed`, nothing. The one table built to make email failures visible was the
 * one place this failure could not be seen.
 *
 * The cause was ordering. `sendOrderConfirmation` looked up the group's **orders**, returned
 * early when there were none, and only *then* claimed the delivery row. A meal pack purchase has
 * no member orders **by design and by constraint** (`assert_order_group_totals` refuses one that
 * does), so it bailed before the row existed.
 *
 * Andy, 2026-09-17: *"make the 'never attempted' case write a row on every path, not just the
 * pack one — otherwise the next silent email failure is invisible in the same way."*
 *
 * ## Why this test reads the source instead of running the function
 *
 * `order-confirmation.ts` is a Deno module that talks to Resend and to PostgREST; there is no
 * runtime here that can execute it, which is why it had no test at all and why this bug survived.
 * `cors.test.ts` solves the same problem the same way — it parses the functions on disk — so this
 * follows that precedent rather than inventing a second one.
 *
 * What it checks is a **structural invariant**, not an implementation detail: the claim comes
 * before anything that can exit. That is the property that makes the guarantee true for paths
 * nobody has written yet, which is the whole point — the next early return must not be able to
 * make a send invisible.
 */

const CONFIRMATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/functions/_shared/order-confirmation.ts',
);

const raw = readFileSync(CONFIRMATION, 'utf8');

/**
 * Comments stripped before any scan.
 *
 * The first version of the early-return check counted two returns and failed — and the second was
 * inside the doc comment explaining the bug, which quotes `return 'failed'` verbatim. A test that
 * reads prose as code fails whenever somebody explains themselves clearly, which is the opposite
 * of what should happen. Blanked rather than deleted so every offset still lines up with `raw`.
 */
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

/** Where the delivery row is claimed — the insert that records "we are about to try". */
const claimAt = source.indexOf("from('notification_delivery').insert(");
/** Where the group's member orders are read. A pack purchase has none. */
const ordersAt = source.indexOf(".from('order')\n");

describe('the delivery row is claimed before anything can exit', () => {
  it('finds both landmarks, so the comparisons below mean something', () => {
    // Guards the test itself: a rename that moved either would otherwise make every assertion
    // below compare -1 against -1 and pass while proving nothing.
    expect(claimAt, 'the notification_delivery claim').toBeGreaterThan(-1);
    expect(ordersAt, "the group's orders lookup").toBeGreaterThan(-1);
  });

  it('CLAIMS THE SEND BEFORE READING ORDERS — the exact bug, as an ordering', () => {
    /*
     * This one assertion is the whole fix. With the claim after the lookup, a group with no
     * orders — every meal pack purchase — returned before the row existed, and the failure was
     * invisible everywhere.
     */
    expect(claimAt).toBeLessThan(ordersAt);
  });

  it('has no early return between knowing the group and claiming the row', () => {
    /*
     * The space where a future `return` would reintroduce the bug. Exactly one exit is allowed
     * before the claim — the group that does not exist, which genuinely cannot be recorded
     * because the row is keyed on the group and the user, and neither is known.
     */
    const groupAt = source.indexOf("from('order_group')");
    expect(groupAt).toBeGreaterThan(-1);
    const between = source.slice(groupAt, claimAt);
    const returns = between.match(/return\s+'/g) ?? [];
    expect(
      returns.length,
      'a return added here makes a send invisible again — record the attempt first',
    ).toBe(1);
  });
});

describe('a meal pack purchase is a first-class case, not an accident', () => {
  it('branches on the group kind rather than on "no orders"', () => {
    // "No orders" is a symptom shared by a pack purchase and a genuinely broken food group, and
    // treating them the same is what hid this. The kind is the fact; the row count is a guess.
    expect(source).toMatch(/kind === 'meal_pack_purchase'/);
  });

  it('selects `kind` on the group, or the branch above can never be true', () => {
    // A missing column in a PostgREST select is not an error — it is `undefined`, silently, and
    // the branch simply never fires.
    expect(source).toMatch(/from\('order_group'\)[\s\S]{0,120}kind/);
  });

  it('still records a FAILED attempt for a food group with no orders', () => {
    // The other half of Andy's instruction. A food group with no orders is a real fault and must
    // be visible — it just must not be confused with a pack.
    expect(source).toMatch(/no_orders_in_group/);
    const at = source.indexOf('no_orders_in_group');
    expect(at, 'the food-group failure is recorded after the claim').toBeGreaterThan(claimAt);
  });

  it('does not read a pickup code or a child name for a pack', () => {
    // A pack is owned by a parent and is not a meal on a day. Deriving a service date, a break
    // label or a recipient name from an empty orders list would put empty strings in an email.
    const packBranch = source.slice(source.indexOf('isPackPurchase'));
    expect(packBranch).toMatch(/isPackPurchase\s*\n?\s*\?\s*\{ data: \[\]/);
  });
});

describe('every exit after the claim resolves the row', () => {
  it('suppresses with a reason rather than leaving it queued', () => {
    // `queued` forever is the same invisibility in a different costume: a row that exists and
    // never resolves tells a reader the send is still in flight.
    expect(source).toMatch(/finish\('suppressed', \{ suppressed_reason: 'no_email_on_account' \}\)/);
    expect(source).toMatch(/email_provider_not_configured/);
  });

  it('marks a provider failure as failed, so it can be retried', () => {
    expect(source).toMatch(/finish\('failed'/);
  });
});

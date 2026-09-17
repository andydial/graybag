import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `E21-99`. **Where the delivery email is called from, and on what.**
 *
 * `delivery-notice.test.ts` runs the sender and proves what it does. It cannot prove the sender is
 * ever *reached*, and that is the half that was missing for the whole life of the product:
 * `kitchen-order-status` had exactly one email call and it sat inside `if (to === 'cancelled')`.
 * Delivering food told the parent nothing, and no test anywhere noticed, because every test was
 * about the emails that did exist.
 *
 * So this reads the caller, the way `cors.test.ts` and `order-confirmation.test.ts` do — an Edge
 * Function handler needs Deno, a database and a request, none of which exist here. Comments are
 * blanked first because the ones in that file quote the very conditions being scanned for.
 */

const HANDLER = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/functions/kitchen-order-status/index.ts',
);

const source = readFileSync(HANDLER, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

const cancelledAt = source.indexOf("if (to === 'cancelled' && result.updated.length > 0)");
const deliveredAt = source.indexOf("if (to === 'delivered' && result.updated.length > 0)");

describe('the kitchen tells the parent when the food arrives', () => {
  it('finds both branches, so every comparison below means something', () => {
    // Without this a rename makes each assertion compare -1 against -1 and pass while proving
    // nothing — the failure mode of every source-scanning test.
    expect(cancelledAt, 'the cancellation branch').toBeGreaterThan(-1);
    expect(deliveredAt, 'the delivery branch').toBeGreaterThan(-1);
  });

  it('SENDS ON DELIVERED AT ALL — the gap this closes', () => {
    expect(source).toContain('sendDeliveryNotice');
    expect(source).toMatch(/import \{ sendDeliveryNotice \} from '\.\.\/_shared\/delivery-notice\.ts'/);
  });

  it('is ALONGSIDE the cancellation branch, not inside it', () => {
    /*
     * Andy asked for it *"alongside the existing cancelled branch rather than inside it"*, and the
     * reason is more than tidiness: nested, it would inherit that branch's guards, and a change to
     * cancellation would silently change when a delivery email is sent. `to` holds one value per
     * request, so the two can never both run.
     *
     * Checked as a brace balance rather than by indentation, which proves nothing about nesting.
     */
    const between = source.slice(cancelledAt, deliveredAt);
    const opened = (between.match(/\{/g) ?? []).length;
    const closed = (between.match(/\}/g) ?? []).length;
    expect(opened, 'the cancellation block must be closed before the delivery block opens').toBe(
      closed,
    );
  });

  it('keys on the STATE CHANGE — result.updated, never the ids that were asked for', () => {
    /*
     * Andy: *"a second transition to delivered, or an order already delivered, must not send a
     * second email. Key it on the state change, not the button."*
     *
     * `result.updated` holds only the orders whose status actually moved; `skipped` holds the ones
     * that were already there. The rows are taken `for update` before that split, so a second
     * tablet pressing the same button blocks, then finds nothing. Sending from `orderIds` would
     * email every order the button touched, every press.
     */
    const branch = source.slice(deliveredAt, deliveredAt + 700);
    expect(branch).toMatch(/result\.updated\.map\(/);
    expect(branch, 'orderIds is what the button sent, not what changed').not.toMatch(/orderIds/);
  });

  it('sends ONE EMAIL PER ORDER — a map over ids, not one call for the batch', () => {
    // "Bulk delivery of many orders must produce one email per order, not one per item and not one
    // combined digest." Thirty orders is thirty calls, each rendering its own order's lines.
    const branch = source.slice(deliveredAt, deliveredAt + 700);
    expect(branch).toMatch(/sendDeliveryNotice\(admin, \{ orderId \}\)/);
  });

  it('CANNOT FAIL THE DELIVERY — the send is caught', () => {
    // "If the email fails, the order is still delivered — the kitchen's action must not depend on
    // Resend being up." The food is handed over and the transaction has committed; a provider
    // having a bad minute must not become a 500 telling the kitchen it did not happen.
    const branch = source.slice(deliveredAt, deliveredAt + 700);
    expect(branch).toMatch(/\.catch\(/);
  });

  it('runs AFTER the commit, not inside the transaction', () => {
    // The transaction is the record; an email is not. Both email branches sit after `sql.begin`
    // has resolved, which is the rule `docs/enquiry-submission-contract.md` §6 sets.
    const commitAt = source.indexOf("if ('illegal' in result)");
    expect(commitAt).toBeGreaterThan(-1);
    expect(deliveredAt).toBeGreaterThan(commitAt);
  });
});

/**
 * `E21-100`. **A cancellation is per order, and so is its dedup key.**
 *
 * Found while building `E21-99` rather than by a report, because the delivery email would have
 * inherited it verbatim: `cancellation-notice.ts` claimed its row with `order_group_id` set as
 * well as `order_id`. `uq_notification_one_per_order_group` is unique on `(order_group_id,
 * template_code, channel)`, and **`create_checkout` writes one order per service date into one
 * group** — so cancelling two days of the same cart claimed once and collided once, and the
 * collision reads as `already_sent`. One parent, two cancelled lunches, one email, and an outcome
 * that said both were handled.
 *
 * `0065` exists precisely because the group is the wrong grain for a per-order notice. Setting the
 * column anyway put the row back into the domain that migration was written to escape.
 *
 * It has never fired — production has zero groups with more than one order, read rather than
 * assumed. Latent, like `E21-98`, and fixed before it was not.
 */
describe('neither per-order notice is keyed on the group', () => {
  const NOTICE = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/functions/_shared/cancellation-notice.ts',
  );
  const notice = readFileSync(NOTICE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

  it('the cancellation notice claims order_group_id as NULL', () => {
    expect(notice).toMatch(/order_group_id:\s*null/);
    // The exact defect: the group taken off the order and written to the row.
    expect(notice).not.toMatch(/order_group_id:\s*order\.order_group_id/);
  });

  it('still keys on the order, which is what actually dedupes it', () => {
    expect(notice).toMatch(/order_id:\s*order\.id/);
  });
});

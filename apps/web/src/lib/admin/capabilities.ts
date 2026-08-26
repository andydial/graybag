/**
 * What each job can actually see, derived from its grants — `E10-51`.
 *
 * The prototype ends People & access with a panel headed *"What each role can see"*, and its
 * entry for Kitchen is the sharpest sentence in the whole file:
 *
 * > *"This is the one role where getting scope wrong exposes children's data to someone who
 * > doesn't need it."*
 *
 * ## Why this is computed rather than written
 *
 * A panel like that is prose sitting next to a permission list, and prose does not move when the
 * list does. Somebody adds `orders.view_financials` to the kitchen bundle for a good reason one
 * afternoon, and the screen goes on saying **no prices, no revenue** — confidently, in the place
 * people go to check. A wrong reassurance is worse than no reassurance, because it stops the
 * question being asked again.
 *
 * So every line here is derived from `JOBS[].grants`. If a bundle changes, the panel changes with
 * it in the same commit, whether or not anybody remembered this file existed.
 *
 * `capabilities.test.ts` then asserts the invariants Andy stated as a requirement — no kitchen job
 * reads money, parent contact details, or another kitchen — against the same source. The panel
 * describes; the test enforces; `scripts/test/kitchen-scope.test.mjs` proves it end to end through
 * a real operator's JWT. Three different altitudes, one fact.
 */
import { JOBS } from './jobs.js';
import type { Job } from './jobs.js';
import type { Grant } from '../backoffice/nav.js';

/** One row of the matrix. `has` decides the tick; `detail` says what it means in practice. */
export interface Capability {
  key: string;
  label: string;
  has: boolean;
  detail: string;
  /**
   * True when *holding* this is the thing worth noticing rather than lacking it.
   *
   * Reading children's names is not a fault — the kitchen cannot hand the right bag to the right
   * child without them — but it is the line where a scope mistake stops being an inconvenience,
   * so it is marked rather than ticked quietly.
   */
  sensitive?: boolean;
}

export interface JobCapabilities {
  job: Job;
  /** "Their own kitchen", "Their own school", "Every school". */
  reach: string;
  capabilities: Capability[];
}

const has = (job: Job, grant: Grant): boolean => job.grants.includes(grant);

/**
 * How far a job's grants reach.
 *
 * Taken from `scopes` rather than from the grant codes, because scope is the thing a grant is
 * *attached to* — the same `orders.view` is one kitchen or every kitchen depending on where it
 * was granted, which is the whole design (`D3`) and the reason there is no role column.
 */
function reachOf(job: Job): string {
  if (job.scopes.includes('platform')) return 'Every school and every kitchen';
  if (job.scopes.length > 1) return 'Whichever kitchen or school they are granted on — one, not all';
  if (job.scopes[0] === 'kitchen') return 'Their own kitchen only';
  if (job.scopes[0] === 'school') return 'Their own school only';
  return 'Whatever they are granted on';
}

export function capabilitiesOf(job: Job): JobCapabilities {
  const financials = has(job, 'orders.view_financials');
  const pii = has(job, 'orders.view_pii');
  const users = has(job, 'users.view');
  /*
   * Whether they can see an order at all changes what "cannot see children's names" *means*.
   *
   * For a kitchen job it means "you see the order but not whose it is". For the school office,
   * which holds `reports.view` and nothing else, there is no order to see in the first place —
   * and telling somebody they see an anonymous order when they see no order is the kind of small
   * inaccuracy that costs the whole panel its authority.
   */
  const orders = has(job, 'orders.view');

  return {
    job,
    reach: reachOf(job),
    capabilities: [
      {
        key: 'orders',
        label: 'The orders they are scoped to',
        has: orders,
        detail: has(job, 'orders.view')
          ? 'What was ordered, for which day, and its state.'
          : 'No order is visible to them at all.',
      },
      {
        key: 'money',
        label: 'Prices, revenue and refunds',
        has: financials,
        detail: financials
          ? 'Every money column, and the reports built on them.'
          : orders
          ? 'No price, no total, no revenue. Order money is a separate grant they do not hold.'
          : 'No order money. The monthly report they do see is totals for their own school.',
      },
      {
        key: 'children',
        label: 'Children’s names, class and allergy badges',
        has: pii,
        sensitive: pii,
        detail: pii
          ? 'Needed to hand the right bag to the right child — and the reason scope matters most here.'
          : orders
          ? 'They see an order without knowing whose it is.'
          : 'Nothing about any child. They cannot see an order to attach one to.',
      },
      {
        key: 'parents',
        label: 'Parent names and contact details',
        has: users,
        sensitive: users,
        detail: users
          ? 'Can read the account list, including email addresses.'
          : 'No parent’s email, phone or name — not even for an order they can see.',
      },
      {
        key: 'cancel',
        label: 'Cancelling an order',
        has: has(job, 'orders.cancel'),
        detail: has(job, 'orders.cancel')
          ? 'With a typed reason, which is emailed to the parent. Cancelling does not refund.'
          : 'Cannot cancel. They would ask somebody who can.',
      },
      {
        key: 'refund',
        label: 'Refunding money',
        has: has(job, 'orders.refund'),
        sensitive: has(job, 'orders.refund'),
        detail: has(job, 'orders.refund')
          ? 'Can move real money back to a parent.'
          : 'Cannot refund. Deliberately separate from cancelling.',
      },
      {
        key: 'menu',
        label: 'Changing what parents are offered',
        has: has(job, 'menu.edit'),
        detail: has(job, 'menu.edit')
          ? 'Dishes, prices, allergens and photos — every parent sees the result.'
          : 'Can look at the menu but not change it.',
      },
      {
        key: 'grants',
        label: 'Giving other people access',
        has: has(job, 'grants.manage'),
        sensitive: has(job, 'grants.manage'),
        detail: has(job, 'grants.manage')
          ? 'Can grant and revoke anything on this page, including this.'
          : 'Cannot change anybody’s access, including their own.',
      },
    ],
  };
}

export function allCapabilities(): JobCapabilities[] {
  return JOBS.map(capabilitiesOf);
}

/**
 * The parent row, which is not a job and has no grants.
 *
 * Included on the panel because *"anyone who signs up is a parent"* is the thing the screen most
 * needs to say — back-office access is granted afterwards, which is why kitchen staff appear in
 * the account list looking exactly like a customer. Leaving the baseline off the panel makes the
 * four jobs read as four kinds of user, which is precisely the model this system does not have.
 */
export const PARENT_BASELINE = {
  label: 'Parent',
  reach: 'Their own children and their own orders',
  summary:
    'What every registered account can do before anything is granted. Nothing else exists to ' +
    'them — no other family, no other order, no menu they are not offered.',
};

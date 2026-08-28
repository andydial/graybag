import { describe, expect, it } from 'vitest';

import { blockReason, planActionLabel, planFailure, planMessage, summarisePlan } from './pack-plan.js';

/**
 * `E21-41`. The planner's arithmetic — the half where an over-spend would hide.
 *
 * The server refuses a plan that overdraws (`spend_meal_pack_meals` is all-or-nothing under
 * contention), so nothing here can cost a parent a meal. What it can cost is their **work**: a
 * refusal arriving after twenty items have been chosen across seven days is a refusal that wastes
 * the afternoon. These assertions are about the warning arriving early enough to act on.
 */

const RULE = { itemsPerMeal: 2, requiredCategoryId: 'drinks' };
const meal = () => [
  { categoryId: 'mains', quantity: 1 },
  { categoryId: 'drinks', quantity: 1 },
];
const halfMeal = () => [{ categoryId: 'mains', quantity: 1 }];
const day = (date: string, items: ReturnType<typeof meal>) => ({
  date,
  recipientId: 'r-1',
  items,
});

describe('summarisePlan', () => {
  it('counts a plan that fits', () => {
    const s = summarisePlan([day('2026-09-01', meal()), day('2026-09-02', meal())], 10, RULE);
    expect(s).toMatchObject({ chosen: 2, valid: 2, incomplete: 0, overBy: 0, canConfirm: true });
    expect(s.remainingAfter).toBe(8);
  });

  it('counts CHOSEN days against the balance, not completed ones', () => {
    // The line that matters. Eight days chosen with five meals is over budget the moment the
    // eighth is picked — not later, when the parent has finished five and starts the sixth.
    // Counting valid days would have said "5 of 5 ready" and hidden it until the work was done.
    const days = [
      day('2026-09-01', meal()),
      day('2026-09-02', meal()),
      day('2026-09-03', meal()),
      day('2026-09-04', meal()),
      day('2026-09-05', meal()),
      day('2026-09-07', halfMeal()),
      day('2026-09-08', halfMeal()),
      day('2026-09-09', halfMeal()),
    ];
    const s = summarisePlan(days, 5, RULE);
    expect(s.chosen).toBe(8);
    expect(s.valid).toBe(5);
    expect(s.overBy).toBe(3);
    expect(s.canConfirm).toBe(false);
  });

  it('refuses to confirm while any day is incomplete', () => {
    const s = summarisePlan([day('2026-09-01', meal()), day('2026-09-02', halfMeal())], 10, RULE);
    expect(s.incomplete).toBe(1);
    expect(s.canConfirm).toBe(false);
  });

  it('refuses to confirm an empty plan', () => {
    expect(summarisePlan([], 10, RULE).canConfirm).toBe(false);
  });

  it('never reports a negative remainder', () => {
    // A parent with 2 meals who has somehow planned 4 valid days must not see "-2 will stay in
    // your pack". `canConfirm` is already false; the number still has to read sanely.
    const days = ['01', '02', '03', '04'].map((d) => day(`2026-09-${d}`, meal()));
    const s = summarisePlan(days, 2, RULE);
    expect(s.remainingAfter).toBe(0);
    expect(s.canConfirm).toBe(false);
  });

  it('lets a plan use the whole balance exactly', () => {
    const days = ['01', '02'].map((d) => day(`2026-09-${d}`, meal()));
    const s = summarisePlan(days, 2, RULE);
    expect(s).toMatchObject({ overBy: 0, canConfirm: true, remainingAfter: 0 });
  });

  it('applies the offer’s rule, not a hardcoded two-items-one-drink', () => {
    const three = { itemsPerMeal: 3, requiredCategoryId: 'drinks' };
    expect(summarisePlan([day('2026-09-01', meal())], 5, three).valid).toBe(0);
  });
});

describe('planMessage', () => {
  it('says over-budget FIRST when both problems are true', () => {
    // Finishing the incomplete days would not help — the plan is too big either way — and
    // telling someone to choose items for a day they must remove is worse than saying nothing.
    const days = ['01', '02', '03'].map((d, i) =>
      day(`2026-09-0${d}`, i === 0 ? halfMeal() : meal()),
    );
    const s = summarisePlan(days, 2, RULE);
    expect(s.overBy).toBeGreaterThan(0);
    expect(s.incomplete).toBeGreaterThan(0);
    expect(planMessage(s, 2)).toMatch(/only 2 meals left/);
    expect(planMessage(s, 2)).not.toMatch(/still need/);
  });

  it('says how many to remove, not just that it is too many', () => {
    const days = ['01', '02', '03'].map((d) => day(`2026-09-0${d}`, meal()));
    expect(planMessage(summarisePlan(days, 1, RULE), 1)).toMatch(/Remove 2/);
  });

  it('is singular for one meal left', () => {
    const days = ['01', '02'].map((d) => day(`2026-09-0${d}`, meal()));
    expect(planMessage(summarisePlan(days, 1, RULE), 1)).toMatch(/only 1 meal left/);
  });

  it('names how many days still need items, singular and plural', () => {
    const one = summarisePlan([day('2026-09-01', halfMeal())], 10, RULE);
    expect(planMessage(one, 10)).toMatch(/1 day still needs items/);
    const two = summarisePlan(
      [day('2026-09-01', halfMeal()), day('2026-09-02', halfMeal())],
      10,
      RULE,
    );
    expect(planMessage(two, 10)).toMatch(/2 days still need items/);
  });

  it('says what will be left when the plan is ready', () => {
    const s = summarisePlan([day('2026-09-01', meal())], 10, RULE);
    expect(planMessage(s, 10)).toMatch(/9 will stay in your pack/);
  });

  it('invites a start when nothing is chosen', () => {
    expect(planMessage(summarisePlan([], 10, RULE), 10)).toMatch(/Choose a day to start/);
  });
});

describe('planActionLabel', () => {
  it('counts the meals it is about to spend', () => {
    const days = ['01', '02'].map((d) => day(`2026-09-0${d}`, meal()));
    expect(planActionLabel(summarisePlan(days, 10, RULE))).toBe('Confirm 2 meals');
  });

  it('is singular for one', () => {
    expect(planActionLabel(summarisePlan([day('2026-09-01', meal())], 10, RULE))).toBe(
      'Confirm 1 meal',
    );
  });

  it('does not promise a confirm it will refuse', () => {
    const s = summarisePlan([day('2026-09-01', halfMeal())], 10, RULE);
    expect(planActionLabel(s)).toBe('Review your days');
  });
});

describe('blockReason — every refusal is shown ON the day it applies to', () => {
  const OPEN = { cutoffPassed: false, serves: true, expiresOn: '2026-10-11' };

  it('allows an ordinary day', () => {
    expect(blockReason('2026-09-01', OPEN)).toBeNull();
  });

  it('refuses a day past its cutoff', () => {
    expect(blockReason('2026-09-01', { ...OPEN, cutoffPassed: true })).toBe('cutoff_passed');
  });

  it('refuses a day the school does not serve', () => {
    expect(blockReason('2026-09-06', { ...OPEN, serves: false })).toBe('no_service');
  });

  it('refuses a day after the pack expires', () => {
    expect(blockReason('2026-10-13', OPEN)).toBe('after_expiry');
  });

  it('allows the expiry day itself', () => {
    // The pack is valid THROUGH its expiry date, and an off-by-one here would quietly cost a
    // parent their last meal.
    expect(blockReason('2026-10-11', OPEN)).toBeNull();
  });

  it('says EXPIRY first when a day is both after expiry and unserved', () => {
    // Expiry is the reason with a deadline attached — it is the one a parent needs to act on,
    // and "the school doesn't serve on Sundays" would send them looking at the wrong thing.
    expect(blockReason('2026-10-18', { ...OPEN, serves: false, cutoffPassed: true })).toBe(
      'after_expiry',
    );
  });
});

/**
 * `E21-50`. What a parent is told when confirming is refused.
 *
 * The property under test is one sentence: **we may only promise "nothing has been spent" when
 * the server actually answered.** A refusal means the transaction rolled back and the promise is
 * safe. Silence means we do not know, and saying it anyway would be a guess dressed as a
 * reassurance — on the question a parent asks first.
 */
describe('planFailure', () => {
  it('is null when nothing failed', () => {
    expect(planFailure(null)).toBeNull();
  });

  it('passes the server’s own sentence through, rather than inventing one', () => {
    const failure = planFailure({
      code: 'cutoff_passed',
      message: 'Ordering has closed for one of those days.',
    });
    expect(failure?.message).toBe('Ordering has closed for one of those days.');
  });

  it('promises nothing was spent when the server refused', () => {
    // Safe to promise: `confirm_meal_pack_plan` is one transaction, and a refusal rolled it back.
    expect(planFailure({ code: 'not_eligible', message: 'x' })?.spendKnown).toBe(true);
  });

  it('does NOT promise it when there was no answer at all', () => {
    // The one that matters. A timeout leaves the transaction's fate unknown, and a parent told
    // "nothing has been spent" who then finds meals missing has been lied to at the worst moment.
    expect(planFailure({ message: 'Network request failed' })?.spendKnown).toBe(false);
  });

  it('offers a retry that is honest about idempotency when it cannot say', () => {
    // Reassurance we can actually back: one key per plan across retries (`E21-47`).
    expect(planFailure({ message: 'timeout' })?.message).toMatch(
      /can’t be spent twice/,
    );
  });

  it.each(['cutoff_passed', 'day_after_expiry', 'insufficient_meals'])(
    'marks %s stale, because retrying the same plan is refused identically',
    (code) => {
      expect(planFailure({ code, message: 'x' })?.stale).toBe(true);
    },
  );

  it.each(['not_eligible', 'empty_plan', 'unknown_recipient'])(
    'does not mark %s stale — the plan is wrong, not out of date',
    (code) => {
      expect(planFailure({ code, message: 'x' })?.stale).toBe(false);
    },
  );

  it('a lost request is not stale — the plan may have been perfectly good', () => {
    expect(planFailure({ message: 'offline' })?.stale).toBe(false);
  });
});

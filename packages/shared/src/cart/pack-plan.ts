/**
 * The multi-day planner's arithmetic. `E21-41`.
 *
 * Buying a pack is one screen. **Spending ten meals across a fortnight is where a parent either
 * gets value or gives up**, which is why the prototype makes it a planner rather than ten separate
 * visits to the cart — and why this file is pure and tested rather than arithmetic inside a
 * component.
 *
 * ## What it must never get wrong
 *
 * A parent must not be able to confirm a plan that spends more meals than they hold. The server
 * refuses it — `spend_meal_pack_meals` is all-or-nothing under contention (`E21-25`) — but a
 * refusal that arrives *after* someone has chosen twenty items across seven days is a refusal
 * that wastes their work. So the count is checked continuously, stated in the footer, and the
 * confirm button is disabled while it is wrong.
 *
 * The server remains the authority. This decides what to *show* and what to *enable*, never what
 * is spent.
 */
import { checkPackMeal, type ChosenItem, type PackMealRule } from './pack-eligibility.js';

/** One day a parent has picked, and what they chose for it. */
export interface PlannedDay {
  /** The service date, `YYYY-MM-DD`. */
  date: string;
  /** Which child this day is for. A pack is the parent's, so days may name different children. */
  recipientId: string;
  items: readonly ChosenItem[];
}

/** Why a day cannot be planned at all. Shown ON the day, not at confirm time. */
export type DayBlock = 'cutoff_passed' | 'no_service' | 'after_expiry' | null;

export interface PlanSummary {
  /** Days the parent has touched. */
  chosen: number;
  /** Days whose items make a valid meal. */
  valid: number;
  /** Days chosen but not yet complete. */
  incomplete: number;
  /** How many meals over the balance this plan is. Zero when it fits. */
  overBy: number;
  /** Meals that would remain in the pack afterwards. Never negative. */
  remainingAfter: number;
  /** Whether Confirm may be pressed. */
  canConfirm: boolean;
}

/**
 * Summarise a plan against a balance.
 *
 * **`overBy` counts CHOSEN days, not valid ones**, and that is the important line. Counting only
 * the complete days would let a parent pick eight days with a balance of five, finish five of
 * them, see "5 of 5 ready", and only discover the problem as they completed the sixth. The
 * warning has to arrive when the eighth day is *chosen*, which is when they can still change
 * their mind cheaply.
 */
export function summarisePlan(
  days: readonly PlannedDay[],
  mealsLeft: number,
  rule: PackMealRule,
): PlanSummary {
  const chosen = days.length;
  const valid = days.filter((day) => checkPackMeal(day.items, rule) === null).length;
  const incomplete = chosen - valid;
  const overBy = Math.max(0, chosen - mealsLeft);

  return {
    chosen,
    valid,
    incomplete,
    overBy,
    remainingAfter: Math.max(0, mealsLeft - valid),
    // Every condition is a reason a parent would be refused later. Confirm stays disabled until
    // none of them holds, so the refusal never arrives after the work.
    canConfirm: chosen > 0 && incomplete === 0 && overBy === 0,
  };
}

/**
 * The sentence in the footer.
 *
 * Ordered by which problem to say first when several are true at once: **over-budget beats
 * incomplete**, because finishing the incomplete days would not help — the plan is too big either
 * way, and telling someone to "choose two items" for a day they must remove is worse than saying
 * nothing.
 */
export function planMessage(summary: PlanSummary, mealsLeft: number): string {
  if (summary.overBy > 0) {
    return (
      `${summary.chosen} days chosen but only ${mealsLeft} ` +
      `${mealsLeft === 1 ? 'meal' : 'meals'} left. ` +
      `Remove ${summary.overBy}, or buy another pack.`
    );
  }
  if (summary.incomplete > 0) {
    return (
      `${summary.incomplete} day${summary.incomplete > 1 ? 's' : ''} still ` +
      `${summary.incomplete > 1 ? 'need' : 'needs'} items. ` +
      `${summary.valid} of ${mealsLeft} meals ready.`
    );
  }
  if (summary.chosen === 0) return 'Choose a day to start.';
  return (
    `${summary.valid} of ${mealsLeft} meals ready to confirm · ` +
    `${summary.remainingAfter} will stay in your pack`
  );
}

/** The label on the confirm button. */
export function planActionLabel(summary: PlanSummary): string {
  if (summary.chosen === 0) return 'Choose a day to start';
  if (!summary.canConfirm) return 'Review your days';
  return `Confirm ${summary.valid} meal${summary.valid > 1 ? 's' : ''}`;
}

/**
 * Why a day cannot be planned, given the rules that apply to it.
 *
 * All four of the prototype's refusals are computed here rather than filtered out of the list,
 * because *"a planner that only shows bookable days teaches nobody why the others are missing"*.
 * A parent who cannot see Sunday assumes the app is broken; one who sees "the school doesn't serve
 * on Sundays" has learned something.
 *
 * `expiresOn` is compared as a date string, which is safe because both sides are `YYYY-MM-DD` in
 * the kitchen's timezone — the comparison that broke `defaultServiceDate` was an instant against a
 * local date, and this is neither.
 */
export function blockReason(
  date: string,
  { cutoffPassed, serves, expiresOn }: {
    cutoffPassed: boolean;
    serves: boolean;
    expiresOn: string;
  },
): DayBlock {
  // Expiry first: a day after the pack expires cannot be planned even if everything else about it
  // is fine, and it is the reason a parent most needs to see — it is the one with a deadline.
  if (date > expiresOn) return 'after_expiry';
  if (!serves) return 'no_service';
  if (cutoffPassed) return 'cutoff_passed';
  return null;
}

/**
 * What to show a parent when confirming a plan is refused — `E21-50`.
 *
 * ## The two failures are not the same promise, and saying so matters
 *
 * `confirm_meal_pack_plan` is one transaction. When the server **answers with a refusal code**,
 * that transaction rolled back, so "nothing has been spent" is a guarantee we can make in those
 * words. When there is **no answer at all** — a timeout, a dropped connection — we do not know
 * whether it committed, and promising the same thing would be a guess dressed as a reassurance.
 *
 * A parent's first question on a failed confirm is *"have my meals gone?"*. Answering it
 * confidently when we cannot know is the failure mode worth avoiding here, and the honest
 * version is still reassuring, because the plan carries **one idempotency key across retries**
 * (`E21-47`): pressing again cannot spend twice, whichever way the lost request landed.
 *
 * ## `stale` decides whether the fix is "try again" or "look at your plan"
 *
 * `cutoff_passed`, `day_after_expiry` and `insufficient_meals` all mean the world moved while
 * the parent was choosing — another device spent a meal, a cutoff arrived. Retrying the same
 * plan will be refused identically, so the calendar has to be reloaded first. Offering a bare
 * "Try again" there sends a parent round a loop that cannot succeed.
 */
export interface PlanFailure {
  /** The sentence the server sent, or ours when it never answered. */
  message: string;
  /** Can we promise nothing was spent? False only when the server never answered. */
  spendKnown: boolean;
  /** The plan itself is out of date; reload the days before trying again. */
  stale: boolean;
}

/** Refusals that mean the plan no longer matches the world, so retrying it cannot help. */
const STALE_CODES = new Set(['cutoff_passed', 'day_after_expiry', 'insufficient_meals']);

export function planFailure(error: { message?: string; code?: string } | null): PlanFailure | null {
  if (error === null) return null;

  const code = error.code ?? '';
  // No code means the request never reached a verdict — the Edge Function attaches one to every
  // refusal it recognises. Anything else is a transport failure or a 500, and both are silent
  // about what happened to the transaction.
  if (code === '') {
    return {
      message:
        'We couldn’t reach GrayBag to confirm those meals. Press Confirm again — the same plan ' +
        'can’t be spent twice, so you won’t lose meals by retrying.',
      spendKnown: false,
      stale: false,
    };
  }

  return {
    message: error.message ?? 'We couldn’t plan those meals.',
    spendKnown: true,
    stale: STALE_CODES.has(code),
  };
}

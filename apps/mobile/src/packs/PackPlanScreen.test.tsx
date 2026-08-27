import { render, screen, userEvent } from '@testing-library/react-native';

import { PackPlanScreen, type PlannableDay } from './PackPlanScreen';

/**
 * `E21-41`. The planner, as a parent meets it.
 *
 * The arithmetic is proven in `pack-plan.test.ts`. What this file asserts is what the *screen*
 * owes: every refusal visible on the day it applies to, the count in the footer at all times, and
 * a confirm that cannot be pressed into a refusal.
 */

let mockSurface: {
  canBuy: boolean;
  hasBalance: boolean;
  loading: boolean;
  balance: {
    mealsRemaining: number;
    itemsPerMeal: number;
    requiredCategoryId: string;
    expiresAt: string;
  } | null;
};

jest.mock('./MealPackSurfaceContext', () => ({
  useMealPackSurface: () => mockSurface,
}));

const DAYS: PlannableDay[] = [
  { date: '2026-08-27', label: 'Wed 27 Aug', breakLabel: 'Morning break', cutoffPassed: true, serves: true },
  { date: '2026-08-28', label: 'Thu 28 Aug', breakLabel: 'Morning break', cutoffPassed: false, serves: true },
  { date: '2026-08-29', label: 'Fri 29 Aug', breakLabel: 'Morning break', cutoffPassed: false, serves: true },
  { date: '2026-08-31', label: 'Sun 31 Aug', breakLabel: '—', cutoffPassed: false, serves: false },
  { date: '2026-10-13', label: 'Mon 13 Oct', breakLabel: 'Morning break', cutoffPassed: false, serves: true },
];

const KIDS = [
  { id: 'r-1', firstName: 'Aarav' },
  { id: 'r-2', firstName: 'Ishita' },
];

const meal = () => [
  { categoryId: 'mains', quantity: 1 },
  { categoryId: 'drinks', quantity: 1 },
];

beforeEach(() => {
  mockSurface = {
    canBuy: false,
    hasBalance: true,
    loading: false,
    balance: {
      mealsRemaining: 3,
      itemsPerMeal: 2,
      requiredCategoryId: 'drinks',
      expiresAt: '2026-10-11T00:00:00Z',
    },
  };
});

describe('every refusal is shown on the day it applies to', () => {
  it('shows a day past its cutoff rather than hiding it', async () => {
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} />);
    expect(screen.getByTestId('screen-pack-plan-blocked-2026-08-27')).toBeTruthy();
    expect(screen.getByText('Ordering for this day closed last night')).toBeTruthy();
  });

  it('shows a day the school does not serve, with the reason', async () => {
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} />);
    expect(screen.getByText('The school doesn’t serve on this day')).toBeTruthy();
  });

  it('shows a day after the pack expires', async () => {
    // A parent who cannot see 13 Oct assumes the app is broken. One who reads "after your pack
    // expires" has learned something about the pack they bought.
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} />);
    expect(screen.getByText('After your pack expires')).toBeTruthy();
  });

  it('makes a blocked day unpressable, so it cannot be planned by mistake', async () => {
    const onOpenDay = jest.fn();
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} onOpenDay={onOpenDay} />);
    // The blocked rows are Views, not Pressables — there is nothing to press. Asserted by the
    // absence of the day's pressable testID rather than by pressing and hoping.
    expect(screen.queryByTestId('screen-pack-plan-day-2026-08-27')).toBeNull();
    expect(onOpenDay).not.toHaveBeenCalled();
  });

  it('offers the days that ARE bookable', async () => {
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} />);
    expect(screen.getByTestId('screen-pack-plan-day-2026-08-28')).toBeTruthy();
    expect(screen.getByTestId('screen-pack-plan-day-2026-08-29')).toBeTruthy();
  });
});

describe('the footer counts against the balance at all times', () => {
  it('invites a start when nothing is chosen', async () => {
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} />);
    expect(screen.getByTestId('screen-pack-plan-count')).toHaveTextContent(/Choose a day to start/);
  });

  it('warns the moment more days are chosen than there are meals', async () => {
    // Four days against three meals. The warning must be here NOW, while removing one is cheap —
    // not after items have been chosen for three of them.
    const plan = ['2026-08-28', '2026-08-29', '2026-09-01', '2026-09-02'].map((date) => ({
      date,
      recipientId: 'r-1',
      items: [],
    }));
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} />);
    expect(screen.getByTestId('screen-pack-plan-count')).toHaveTextContent(/only 3 meals left/);
    expect(screen.getByTestId('screen-pack-plan-count')).toHaveTextContent(/Remove 1/);
  });

  it('says how many days still need items once the plan fits', async () => {
    const plan = [
      { date: '2026-08-28', recipientId: 'r-1', items: meal() },
      { date: '2026-08-29', recipientId: 'r-1', items: [] },
    ];
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} />);
    expect(screen.getByTestId('screen-pack-plan-count')).toHaveTextContent(/1 day still needs/);
  });

  it('says what will be left in the pack when the plan is ready', async () => {
    const plan = [{ date: '2026-08-28', recipientId: 'r-1', items: meal() }];
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} />);
    expect(screen.getByTestId('screen-pack-plan-count')).toHaveTextContent(/2 will stay in your pack/);
  });
});

describe('confirm cannot be pressed into a refusal', () => {
  it('is disabled with nothing chosen', async () => {
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} />);
    expect(screen.getByTestId('screen-pack-plan-confirm').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('is disabled while a day is incomplete', async () => {
    const plan = [{ date: '2026-08-28', recipientId: 'r-1', items: [] }];
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} />);
    expect(screen.getByTestId('screen-pack-plan-confirm').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('is disabled while the plan is over budget', async () => {
    const plan = ['2026-08-28', '2026-08-29', '2026-09-01', '2026-09-02'].map((date) => ({
      date,
      recipientId: 'r-1',
      items: meal(),
    }));
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} />);
    expect(screen.getByTestId('screen-pack-plan-confirm').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('names the number of meals it is about to spend', async () => {
    const plan = [
      { date: '2026-08-28', recipientId: 'r-1', items: meal() },
      { date: '2026-08-29', recipientId: 'r-1', items: meal() },
    ];
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} />);
    expect(screen.getByText('Confirm 2 meals')).toBeTruthy();
  });

  it('hands the plan up rather than spending anything itself', async () => {
    const onConfirm = jest.fn();
    const plan = [{ date: '2026-08-28', recipientId: 'r-1', items: meal() }];
    await render(
      <PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} onConfirm={onConfirm} />,
    );
    await userEvent.press(screen.getByTestId('screen-pack-plan-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed again while confirming', async () => {
    // The double tap this guards is exactly the input plan-level idempotency exists for, and the
    // server replays it correctly either way. What this protects is what the parent SEES: a
    // button that stops responding rather than one that looks ignored.
    const onConfirm = jest.fn();
    const plan = [{ date: '2026-08-28', recipientId: 'r-1', items: meal() }];
    await render(
      <PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} confirming onConfirm={onConfirm} />,
    );
    await userEvent.press(screen.getByTestId('screen-pack-plan-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('says what it is doing while it does it', async () => {
    const plan = [{ date: '2026-08-28', recipientId: 'r-1', items: meal() }];
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} confirming />);
    expect(screen.getByText('Confirming…')).toBeTruthy();
  });

});

describe('a pack is the parent’s, so a plan may mix children', () => {
  it('offers every child when there is more than one', async () => {
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} selectedRecipientId="r-1" />);
    expect(screen.getByTestId('screen-pack-plan-recipient-r-1')).toBeTruthy();
    expect(screen.getByTestId('screen-pack-plan-recipient-r-2')).toBeTruthy();
  });

  it('says so in as many words', async () => {
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} />);
    expect(screen.getByText(/mix them across days/)).toBeTruthy();
  });

  it('shows WHICH child each planned day is for', async () => {
    const plan = [
      { date: '2026-08-28', recipientId: 'r-1', items: meal() },
      { date: '2026-08-29', recipientId: 'r-2', items: meal() },
    ];
    await render(<PackPlanScreen days={DAYS} recipients={KIDS} plan={plan} />);
    expect(screen.getByText(/for Aarav/)).toBeTruthy();
    expect(screen.getByText(/for Ishita/)).toBeTruthy();
  });

  it('hides the picker for a parent with one child, rather than showing a choice of one', async () => {
    await render(<PackPlanScreen days={DAYS} recipients={[KIDS[0]!]} />);
    expect(screen.queryByTestId('screen-pack-plan-recipient-r-1')).toBeNull();
  });
});

describe('a failed calendar read is not an empty calendar', () => {
  it('says we could not load the days, rather than showing none', async () => {
    // §5.21, and the distinction that cost three hours on the menu. "No days to plan" would be a
    // claim about the school; the truth is that we could not ask.
    await render(<PackPlanScreen days={[]} recipients={KIDS} daysUnavailable />);
    expect(screen.getByTestId('screen-pack-plan-days-unavailable')).toBeTruthy();
    expect(screen.getByText(/We couldn’t load the days/)).toBeTruthy();
  });

  it('reassures that nothing has been spent — the parent’s first worry', async () => {
    await render(<PackPlanScreen days={[]} recipients={KIDS} daysUnavailable />);
    expect(screen.getByText(/Your meals are safe/)).toBeTruthy();
  });

  it('offers a way out rather than a dead end', async () => {
    const onRetryDays = jest.fn();
    await render(
      <PackPlanScreen days={[]} recipients={KIDS} daysUnavailable onRetryDays={onRetryDays} />,
    );
    await userEvent.press(screen.getByText('Try again'));
    expect(onRetryDays).toHaveBeenCalled();
  });

  it('shows nothing of the sort when the calendar simply has no days', async () => {
    await render(<PackPlanScreen days={[]} recipients={KIDS} />);
    expect(screen.queryByTestId('screen-pack-plan-days-unavailable')).toBeNull();
    expect(screen.getByTestId('screen-pack-plan-count')).toHaveTextContent(/Choose a day to start/);
  });
});

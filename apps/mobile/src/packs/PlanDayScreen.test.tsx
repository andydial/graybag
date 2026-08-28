import { render, screen, userEvent } from '@testing-library/react-native';

import { PlanDayScreen, type PickableDish } from './PlanDayScreen';

/**
 * `E21-44`. Choosing the items for one day.
 *
 * The prototype's reason for this screen existing at all: *"the rule is enforced here, in front of
 * the parent, rather than at confirm — a refusal that arrives after the work is a refusal that
 * wastes it."* Every assertion below is about the parent being able to see why they are stuck.
 */

const DISHES: PickableDish[] = [
  { id: 'd-sandwich', name: 'Cheese sandwich', categoryId: 'mains', categoryName: 'Mains', pricePaise: 12000, clashes: [] },
  { id: 'd-pasta', name: 'Wheat pasta', categoryId: 'mains', categoryName: 'Mains', pricePaise: 15000, clashes: ['wheat'] },
  { id: 'd-juice', name: 'Orange juice', categoryId: 'drinks', categoryName: 'Drinks', pricePaise: 8000, clashes: [] },
  { id: 'd-milk', name: 'Cold milk', categoryId: 'drinks', categoryName: 'Drinks', pricePaise: 7000, clashes: ['milk'] },
];

const base = {
  dayLabel: 'Thu 28 Aug',
  breakLabel: 'Morning break',
  childName: 'Aarav',
  dishes: DISHES,
  itemsPerMeal: 2,
  requiredCategoryId: 'drinks',
  requiredCategoryLabel: 'a drink',
};

describe('the rule is stated before the parent is stuck', () => {
  it('says what a meal is, in the offer’s own terms', async () => {
    await render(<PlanDayScreen {...base} />);
    expect(screen.getByText(/2 items, one of them a drink/)).toBeTruthy();
  });

  it('names the required category on its heading', async () => {
    await render(<PlanDayScreen {...base} />);
    expect(screen.getByText('Drinks — one is required')).toBeTruthy();
  });

  it('does NOT mark the other category as required', async () => {
    await render(<PlanDayScreen {...base} />);
    expect(screen.getByText('Mains')).toBeTruthy();
  });

  it('reads the requirement from the offer, so a fruit pack says fruit', async () => {
    // A screen that hardcoded "Drinks" would be silently wrong the day a pack requires something
    // else — and wrong in the most expensive place, where a parent is deciding.
    await render(
      <PlanDayScreen
        {...base}
        requiredCategoryId="mains"
        requiredCategoryLabel="a piece of fruit"
      />,
    );
    expect(screen.getByText('Mains — one is required')).toBeTruthy();
    expect(screen.getByText(/one of them a piece of fruit/)).toBeTruthy();
  });
});

describe('the footer says what is still needed, at every step', () => {
  it('nothing chosen', async () => {
    await render(<PlanDayScreen {...base} selected={[]} />);
    expect(screen.getByTestId('screen-plan-day-status')).toHaveTextContent(/Nothing chosen yet/);
  });

  it('one item chosen', async () => {
    await render(<PlanDayScreen {...base} selected={['d-sandwich']} />);
    expect(screen.getByTestId('screen-plan-day-status')).toHaveTextContent(/Pick one more item/);
  });

  it('two items but no drink — the one a parent gets stuck on', async () => {
    await render(<PlanDayScreen {...base} selected={['d-sandwich', 'd-pasta']} />);
    expect(screen.getByTestId('screen-plan-day-status')).toHaveTextContent(
      /One of the two must be a drink/,
    );
  });

  it('three items', async () => {
    await render(<PlanDayScreen {...base} selected={['d-sandwich', 'd-pasta', 'd-juice']} />);
    expect(screen.getByTestId('screen-plan-day-status')).toHaveTextContent(/remove one/);
  });

  it('a valid meal shows what it is, rather than a bare "ready"', async () => {
    await render(<PlanDayScreen {...base} selected={['d-sandwich', 'd-juice']} />);
    expect(screen.getByTestId('screen-plan-day-status')).toHaveTextContent(
      /Cheese sandwich \+ Orange juice/,
    );
  });
});

describe('the action cannot be pressed into a refusal', () => {
  it('is disabled until the selection is a valid meal', async () => {
    await render(<PlanDayScreen {...base} selected={['d-sandwich']} />);
    expect(screen.getByTestId('screen-plan-day-use').props.accessibilityState.disabled).toBe(true);
  });

  it('names the day once it can be used', async () => {
    await render(<PlanDayScreen {...base} selected={['d-sandwich', 'd-juice']} />);
    expect(screen.getByText('Use this for Thu 28 Aug')).toBeTruthy();
  });

  it('tells you what to do while it is disabled', async () => {
    await render(<PlanDayScreen {...base} selected={[]} />);
    expect(screen.getByText('Pick 2 items, one a drink')).toBeTruthy();
  });

  it('hands the day back rather than deciding anything', async () => {
    const onUseDay = jest.fn();
    await render(
      <PlanDayScreen {...base} selected={['d-sandwich', 'd-juice']} onUseDay={onUseDay} />,
    );
    await userEvent.press(screen.getByTestId('screen-plan-day-use'));
    expect(onUseDay).toHaveBeenCalledTimes(1);
  });

  it('reports a tap on a dish rather than toggling it itself', async () => {
    // The selection lives in the planner, so one screen owns the plan. A local copy here would
    // be a second source of truth for what a parent has chosen.
    const onToggleDish = jest.fn();
    await render(<PlanDayScreen {...base} onToggleDish={onToggleDish} />);
    await userEvent.press(screen.getByTestId('screen-plan-day-dish-d-juice'));
    expect(onToggleDish).toHaveBeenCalledWith('d-juice');
  });
});

/**
 * The same dishes with every clash removed — what the screen is handed when the child's
 * allergens could not be read. Identical on screen to a child with no allergies, which is the
 * whole reason `allergensUnavailable` has to be a separate signal.
 */
const unchecked = base.dishes.map((dish) => ({ ...dish, clashes: [] as string[] }));

describe('allergens warn, and never hide', () => {
  it('warns in the child’s name', async () => {
    await render(<PlanDayScreen {...base} />);
    expect(screen.getByTestId('screen-plan-day-clash-d-pasta')).toHaveTextContent(
      /Contains wheat — Aarav is allergic/,
    );
  });

  it('leaves the clashing dish choosable', async () => {
    // `F5`/`F6`. Hiding it would leave a parent unable to find something they can see on the menu
    // elsewhere, and would quietly turn the allergen list into a filter rather than an alert.
    const onToggleDish = jest.fn();
    await render(<PlanDayScreen {...base} onToggleDish={onToggleDish} />);
    await userEvent.press(screen.getByTestId('screen-plan-day-dish-d-pasta'));
    expect(onToggleDish).toHaveBeenCalledWith('d-pasta');
  });

  it('says nothing about a dish with no clash', async () => {
    await render(<PlanDayScreen {...base} />);
    expect(screen.queryByTestId('screen-plan-day-clash-d-sandwich')).toBeNull();
  });

  it('a clashing dish still makes a valid meal — the warning is not a veto', async () => {
    await render(<PlanDayScreen {...base} selected={['d-pasta', 'd-milk']} />);
    expect(screen.getByTestId('screen-plan-day-use').props.accessibilityState.disabled).toBe(
      false,
    );
  });
});

/**
 * `E21-51`. The distinction between "we looked and found nothing" and "we could not look".
 *
 * These four exist because the screen has exactly one way to be dangerously wrong: showing a
 * dish with no warning on it when the child's allergens were never read. Both states render no
 * clash line, so nothing above this block can tell them apart — which is precisely how the
 * planner shipped with an empty list and looked correct.
 */
describe('an unchecked child is not a safe child', () => {
  it('says so, rather than showing dishes with no warnings on them', async () => {
    await render(<PlanDayScreen {...base} dishes={unchecked} allergensUnavailable />);
    expect(screen.getByTestId('screen-plan-day-allergens-unavailable')).toHaveTextContent(
      /no dish below has been checked/,
    );
  });

  it('names the child, so it is clear whose allergies are unknown', async () => {
    await render(<PlanDayScreen {...base} dishes={unchecked} allergensUnavailable />);
    expect(screen.getByTestId('screen-plan-day-allergens-unavailable')).toHaveTextContent(
      /Aarav’s allergen list/,
    );
  });

  it('shows no clash lines when it cannot check — it must not invent one', async () => {
    await render(<PlanDayScreen {...base} dishes={unchecked} allergensUnavailable />);
    expect(screen.queryByTestId('screen-plan-day-clash-d-pasta')).toBeNull();
  });

  it('stays silent when allergens WERE checked and nothing clashed', async () => {
    // The other half of the property, and the one that fails if a later change decides to show
    // the notice whenever `clashes` happens to be empty. A parent whose child has no allergies
    // must not be told every day that we could not check.
    await render(<PlanDayScreen {...base} dishes={unchecked} />);
    expect(screen.queryByTestId('screen-plan-day-allergens-unavailable')).toBeNull();
  });

  it('still lets the day be used — not being able to check is not a block', async () => {
    // Refusing to plan would be the safe-looking choice and the wrong one: it strands a parent
    // whose only fault is a failed network read, on a screen with no way forward.
    await render(
      <PlanDayScreen
        {...base}
        dishes={unchecked}
        allergensUnavailable
        selected={['d-pasta', 'd-milk']}
      />,
    );
    expect(screen.getByTestId('screen-plan-day-use').props.accessibilityState.disabled).toBe(
      false,
    );
  });
});

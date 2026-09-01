import { render, screen, userEvent } from '@testing-library/react-native';

import { DayPicker } from './DayPicker';

/**
 * `E05-52`. The control the cart did not have.
 *
 * Nine checkouts were refused on production and none succeeded, because the cart stated a date as
 * a fact and offered no way to change it. The assertions that matter here are therefore about
 * what the picker **refuses to offer** — a day the server would reject — and about the two
 * "nothing to show" states staying distinguishable, which is the failure this whole area keeps
 * repeating.
 */
const DAYS = [
  { serviceDate: '2026-09-01', isOrderable: false, reason: 'cutoff_passed' },
  { serviceDate: '2026-09-02', isOrderable: true, reason: null },
  { serviceDate: '2026-09-03', isOrderable: true, reason: null },
  { serviceDate: '2026-09-05', isOrderable: true, reason: null },
  { serviceDate: '2026-09-06', isOrderable: false, reason: 'not_a_service_day' },
];

describe('only days the server will accept', () => {
  it('offers the orderable days', async () => {
    await render(<DayPicker days={DAYS} />);
    expect(screen.getByTestId('cart-day-picker-day-2026-09-02')).toBeTruthy();
    expect(screen.getByTestId('cart-day-picker-day-2026-09-03')).toBeTruthy();
    expect(screen.getByTestId('cart-day-picker-day-2026-09-05')).toBeTruthy();
  });

  it('DOES NOT OFFER A CLOSED DAY — not offered-then-refused', async () => {
    // The exact trap: the cart pinned a closed day, the parent could not change it, and the
    // refusal blamed a dish. A greyed-out row would still be a row somebody taps.
    await render(<DayPicker days={DAYS} />);
    expect(screen.queryByTestId('cart-day-picker-day-2026-09-01')).toBeNull();
  });

  it('does not offer a non-service day at all', async () => {
    await render(<DayPicker days={DAYS} />);
    expect(screen.queryByTestId('cart-day-picker-day-2026-09-06')).toBeNull();
  });

  it('hands the chosen day back rather than deciding anything', async () => {
    const onSelect = jest.fn();
    await render(<DayPicker days={DAYS} onSelect={onSelect} />);
    await userEvent.press(screen.getByTestId('cart-day-picker-day-2026-09-03'));
    expect(onSelect).toHaveBeenCalledWith('2026-09-03');
  });

  it('marks the selected day as selected, for a screen reader as well as visually', async () => {
    await render(<DayPicker days={DAYS} selected="2026-09-03" />);
    expect(
      screen.getByTestId('cart-day-picker-day-2026-09-03').props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.getByTestId('cart-day-picker-day-2026-09-02').props.accessibilityState.selected,
    ).toBe(false);
  });

  it('names the whole date in the accessibility label, not just "2"', async () => {
    // §7. "Wed 2" is not a date somebody can act on without sight of the column it sits in.
    await render(<DayPicker days={DAYS} />);
    expect(
      screen.getByTestId('cart-day-picker-day-2026-09-02').props.accessibilityLabel,
    ).toMatch(/Wednesday 2 September/);
  });

  it('formats the day in UTC, so a service date does not shift by one', async () => {
    // `defaultServiceDate` shipped exactly this bug. A service date is a calendar day, not an
    // instant, and formatting it in the device zone moves it for anyone west of Greenwich.
    await render(<DayPicker days={[{ serviceDate: '2026-09-02', isOrderable: true, reason: null }]} />);
    expect(screen.getByText('Wed')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });
});

describe('the two ways there is nothing to show are different sentences', () => {
  it('says we could not load the days when the calendar failed', async () => {
    await render(<DayPicker days={[]} unavailable />);
    expect(screen.getByTestId('cart-day-picker-unavailable')).toHaveTextContent(
      /couldn’t load the days/,
    );
  });

  it('reassures that the cart is safe, which is the parent’s first worry', async () => {
    await render(<DayPicker days={[]} unavailable />);
    expect(screen.getByTestId('cart-day-picker-unavailable')).toHaveTextContent(/cart is safe/);
  });

  it('says something DIFFERENT when the school simply has no open days', async () => {
    // The §5.21 distinction. Rendering "no days" for a failed read is how a parent concludes the
    // school has stopped serving, and rendering "we could not check" for a genuinely closed
    // school is a promise we cannot keep.
    await render(<DayPicker days={DAYS.filter((d) => !d.isOrderable)} />);
    expect(screen.getByTestId('cart-day-picker-none')).toBeTruthy();
    expect(screen.queryByTestId('cart-day-picker-unavailable')).toBeNull();
  });

  it('does not claim a failure when it simply has no open days', async () => {
    await render(<DayPicker days={[]} />);
    expect(screen.getByTestId('cart-day-picker-none')).toBeTruthy();
    expect(screen.queryByTestId('cart-day-picker-unavailable')).toBeNull();
  });

  it('offers no tappable day in either empty state', async () => {
    // A picker that renders nothing but still has a row somewhere is the bug in a new coat.
    await render(<DayPicker days={[]} unavailable />);
    expect(screen.queryByTestId('cart-day-picker-day-2026-09-02')).toBeNull();
  });
});

describe('it asks the question the block is for', () => {
  it('labels itself as the delivery day, not as a filter', async () => {
    // Andy: it sits "where 'when should we deliver?' already is". The label is the reason a
    // parent looks here at all.
    await render(<DayPicker days={DAYS} />);
    expect(screen.getByText('When should we deliver?')).toBeTruthy();
  });
});

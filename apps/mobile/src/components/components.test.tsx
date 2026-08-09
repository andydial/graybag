import { render, screen, userEvent } from '@testing-library/react-native';
import { design } from '@graybag/shared';

import { Button, BUTTON_MIN_HEIGHT } from './Button';
import { TextField } from './TextField';
import { Card, EmptyState, ErrorState, ListRow, Skeleton } from './Surfaces';
import { Tabs } from './Tabs';
import { CartBadge } from './cart/CartBadge';
import { ARM_THRESHOLD } from './motion/SwipeRow';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

const flatten = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe('Button', () => {
  it('renders and calls back', async () => {
    const onPress = jest.fn();
    await render(<Button label="Place order" onPress={onPress} testID="b" />);
    await userEvent.setup().press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  /**
   * `S6`, the 500 rule. White on the brand `#00af52` is 2.90:1 — it fails even the 3:1 a
   * control boundary needs. The brand's own Colour Usage Guide assigns `#00AF52` to "Buttons
   * & CTAs", so this is a *documented deviation* (`DS-01`, approved via `E13-14`) rather than
   * a correction to the mocks, which is exactly why it needs a test rather than a comment.
   */
  it('fills with primary-700, never the brand 500', async () => {
    await render(<Button label="Pay" onPress={() => {}} testID="b" />);
    const style = flatten(screen.getByTestId('b').props.style);
    expect(style.backgroundColor).toBe(design.action.primaryBg);
    expect(style.backgroundColor).not.toBe(design.primary[500]);
  });

  it('meets the 48pt touch target on both platforms', async () => {
    // The stricter of iOS's 44 and Android's 48, taken once rather than per-platform.
    await render(<Button label="Pay" onPress={() => {}} testID="b" />);
    expect(flatten(screen.getByTestId('b').props.style).minHeight).toBe(48);
    expect(BUTTON_MIN_HEIGHT).toBe(48);
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Pay" onPress={onPress} disabled testID="b" />);
    await userEvent.setup().press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('announces busy and disabled separately while loading', async () => {
    // A user who cannot see the indicator has no other way to tell "not available" from
    // "working on it".
    await render(<Button label="Pay" onPress={() => {}} loading testID="b" />);
    const state = screen.getByTestId('b').props.accessibilityState;
    expect(state).toMatchObject({ busy: true, disabled: true });
  });

  it('keeps its label while loading rather than swapping in a spinner', async () => {
    // `S5` bans spinners; a control that loses its word also changes size.
    await render(<Button label="Place order" onPress={() => {}} loading />);
    expect(screen.getByText('Place order')).toBeOnTheScreen();
  });
});

describe('TextField', () => {
  it('labels the input for a screen reader, not just visually', async () => {
    await render(<TextField label="Email" value="" onChangeText={() => {}} testID="f" />);
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });

  /**
   * `border.default` is `neutral-400` at 2.28:1 on white — decorative weight, below the 3:1
   * WCAG 1.4.11 needs. An input's outline is the *only* thing marking where the control is,
   * so it uses `border.strong`. `E13-13` lists `border.default` as a forbidden control
   * boundary precisely because it is called "default" and is the one a component reaches for
   * (`S28`).
   */
  it('outlines with border.strong, never border.default', async () => {
    await render(<TextField label="Email" value="" onChangeText={() => {}} testID="f" />);
    const input = screen.getByLabelText('Email');
    const style = flatten(input.props.style);
    expect(style.borderColor).toBe(design.border.strong);
    expect(style.borderColor).not.toBe(design.border.default);
  });

  it('shows an error message when given one', async () => {
    await render(
      <TextField label="Email" value="x" onChangeText={() => {}} error="That is not an email" />,
    );
    expect(screen.getByText('That is not an email')).toBeOnTheScreen();
  });
});

describe('CartBadge', () => {
  it('renders nothing at zero', async () => {
    await render(<CartBadge count={0} />);
    expect(screen.queryByTestId('cart-badge')).toBeNull();
  });

  it('carries a number and a label, never colour alone', async () => {
    // `badge.bg` (amber-500) on white is 1.69, so the badge is a shape with content in it.
    // A bare dot would convey meaning by colour alone — §2.10, and deuteranopia is roughly
    // 6% of Indian men.
    await render(<CartBadge count={3} />);
    expect(screen.getByLabelText('3 items in cart')).toBeOnTheScreen();
  });

  it('singularises one item', async () => {
    await render(<CartBadge count={1} />);
    expect(screen.getByLabelText('1 item in cart')).toBeOnTheScreen();
  });

  it('caps the displayed count so the badge cannot grow unbounded', async () => {
    await render(<CartBadge count={250} />);
    expect(screen.getByText('99+')).toBeOnTheScreen();
    // The label still tells the truth — the cap is visual only.
    expect(screen.getByLabelText('250 items in cart')).toBeOnTheScreen();
  });
});

describe('Surfaces', () => {
  it('gives a list row one label rather than three stops', async () => {
    // A screen reader reading "Veg Sandwich", "Rs 60", "button" as three stops is three
    // times the work for the same information.
    await render(<ListRow title="Veg Sandwich" subtitle="Rs 60.00" onPress={() => {}} testID="r" />);
    expect(screen.getByLabelText('Veg Sandwich, Rs 60.00')).toBeOnTheScreen();
  });

  it('renders a card without requiring a press handler', async () => {
    await render(
      <Card testID="c">
        <Skeleton width={100} height={16} />
      </Card>,
    );
    expect(screen.getByTestId('c')).toBeOnTheScreen();
  });

  it('labels a skeleton as loading rather than leaving it silent', async () => {
    await render(<Skeleton width={100} height={16} testID="s" />);
    const node = screen.getByTestId('s');
    expect(node.props.accessibilityLabel).toBe('Loading');
  });

  it('gives an empty state a heading', async () => {
    await render(<EmptyState title="No orders yet" body="Your orders will appear here." />);
    expect(screen.getByRole('header', { name: 'No orders yet' })).toBeOnTheScreen();
  });

  it('always offers a way forward from an error', async () => {
    // ErrorState requires onRetry rather than accepting an optional one: an error with no
    // way forward is a dead end, and on these connections most errors are transient.
    const onRetry = jest.fn();
    await render(<ErrorState body="We could not load the menu." onRetry={onRetry} />);
    await userEvent.setup().press(screen.getByLabelText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('Tabs', () => {
  const items = [
    { id: 'all', label: 'All' },
    { id: 'drinks', label: 'Drinks' },
  ];

  it('marks the active tab in accessibility state, not only in colour', async () => {
    await render(<Tabs items={items} activeId="drinks" onChange={() => {}} />);
    expect(screen.getByTestId('tabs-drinks').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('tabs-all').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('meets the touch target on every tab', async () => {
    await render(<Tabs items={items} activeId="all" onChange={() => {}} />);
    for (const item of items) {
      const style = flatten(screen.getByTestId(`tabs-${item.id}`).props.style);
      expect(style.minHeight).toBe(design.touchTarget.min);
    }
  });

  it('reports the change by id', async () => {
    const onChange = jest.fn();
    await render(<Tabs items={items} activeId="all" onChange={onChange} />);
    await userEvent.setup().press(screen.getByTestId('tabs-drinks'));
    expect(onChange).toHaveBeenCalledWith('drinks');
  });
});

describe('the catalogue constants the components implement', () => {
  it('arms the swipe at 40% of the row, as M14 specifies', () => {
    expect(ARM_THRESHOLD).toBe(0.4);
  });
});

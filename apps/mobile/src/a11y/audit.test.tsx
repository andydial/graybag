import { render, screen } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { auditA11y, formatViolations, MIN_TOUCH_TARGET } from './audit';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { Card, EmptyState, ErrorState, ListRow, Skeleton } from '../components/Surfaces';
import { Sheet, Tabs } from '../components/Tabs';
import { CartBadge } from '../components/cart/CartBadge';
import { SwipeRow } from '../components/motion/SwipeRow';
import { CartProvider } from '../cart/CartContext';
import { RootNavigator } from '../navigation/RootNavigator';
import { SessionProvider } from '../session/SessionContext';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * `E13-08` / `E13-10` — the accessibility check that runs in CI rather than once.
 *
 * A one-time audit is true on the day it is done and decays with every component added
 * afterwards. This walks the rendered tree of **every** component in the library and every
 * screen in the navigator, so a new unnamed button fails here rather than in a store review
 * or, worse, silently in a parent's hands.
 */

async function auditing(ui: React.ReactElement) {
  await render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
  return auditA11y(screen);
}

const expectClean = (violations: ReturnType<typeof auditA11y>) => {
  expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
};

describe('the audit itself', () => {
  // A check that cannot fail is not a check. These two prove it bites before the rest of
  // the file leans on it passing.
  it('catches an unnamed button', async () => {
    const violations = await auditing(
      <Pressable accessibilityRole="button" onPress={() => {}} testID="bare" />,
    );
    expect(violations.map((v) => v.rule)).toContain('interactive-element-has-name');
  });

  it('catches a button below the touch target', async () => {
    const violations = await auditing(
      <Pressable accessibilityRole="button" onPress={() => {}} style={{ minHeight: 30 }}>
        <Text>Tiny</Text>
      </Pressable>,
    );
    expect(violations.map((v) => v.rule)).toContain('touch-target-minimum');
  });

  it('does not flag a deliberately hidden element', async () => {
    // The loading indicator inside a button whose label already says what is happening.
    const violations = await auditing(
      <View
        accessibilityRole="button"
        accessibilityElementsHidden
        importantForAccessibility="no"
      />,
    );
    expect(violations).toEqual([]);
  });

  it('accepts text content as the accessible name, as the platform does', async () => {
    const violations = await auditing(
      <Pressable accessibilityRole="button" onPress={() => {}} style={{ minHeight: 48 }}>
        <Text>Place order</Text>
      </Pressable>,
    );
    expect(violations).toEqual([]);
  });
});

describe('the component library passes the audit', () => {
  it('Button, in every variant and state', async () => {
    expectClean(
      await auditing(
        <View>
          <Button label="Primary" onPress={() => {}} />
          <Button label="Secondary" onPress={() => {}} variant="secondary" />
          <Button label="Destructive" onPress={() => {}} variant="destructive" />
          <Button label="Disabled" onPress={() => {}} disabled />
          <Button label="Loading" onPress={() => {}} loading />
        </View>,
      ),
    );
  });

  it('TextField, with and without an error', async () => {
    expectClean(
      await auditing(
        <View>
          <TextField label="Email" value="" onChangeText={() => {}} />
          <TextField label="Phone" value="x" onChangeText={() => {}} error="Not a number" />
        </View>,
      ),
    );
  });

  it('the surfaces', async () => {
    expectClean(
      await auditing(
        <View>
          <Card onPress={() => {}}>
            <Text>Card content</Text>
          </Card>
          <ListRow title="Veg Sandwich" subtitle="Rs 60.00" onPress={() => {}} />
          <Skeleton width={100} height={16} />
          <EmptyState title="Nothing yet" body="It will appear here." actionLabel="Browse" onAction={() => {}} />
          <ErrorState body="Could not load." onRetry={() => {}} />
        </View>,
      ),
    );
  });

  it('tabs and the sheet', async () => {
    expectClean(
      await auditing(
        <View>
          <Tabs
            items={[
              { id: 'all', label: 'All' },
              { id: 'drinks', label: 'Drinks' },
            ]}
            activeId="all"
            onChange={() => {}}
          />
          <Sheet visible onDismiss={() => {}} title="Allergens">
            <Text>Contains milk</Text>
          </Sheet>
        </View>,
      ),
    );
  });

  it('the cart badge and the swipe row', async () => {
    expectClean(
      await auditing(
        <View>
          <CartBadge count={3} />
          <SwipeRow actionLabel="Remove" onAction={() => {}}>
            <Text>Veg Sandwich</Text>
          </SwipeRow>
        </View>,
      ),
    );
  });
});

describe('every screen in the navigator passes the audit', () => {
  it('mounts signed out and reports no violations', async () => {
    // Signed out, because that is the state AR7 says must work and therefore the state most
    // likely to be built without being looked at.
    expectClean(
      await auditing(
        <SessionProvider>
          {/* The Cart tab's badge reads the cart during render (`E05-04`). */}
          <CartProvider>
            <RootNavigator />
          </CartProvider>
        </SessionProvider>,
      ),
    );
  });
});

describe('the constant', () => {
  it('is 48 — the stricter of iOS 44 and Android 48, taken once', () => {
    expect(MIN_TOUCH_TARGET).toBe(48);
  });
});

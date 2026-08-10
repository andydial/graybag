import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { design } from '@graybag/shared';

import { STACK_SCREEN_EDGES, Screen, TAB_SCREEN_EDGES } from './Screen';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * An iPhone with a notch, which is the device the defect appeared on. 47 top, 34 bottom are
 * the real numbers for the 6.1" class the first build was installed on; what matters to the
 * test is only that they are non-zero and different from each other, so a component that
 * applied the wrong inset to the wrong edge cannot pass by coincidence.
 */
const NOTCHED = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** A device with no insets at all — the case where the frame must add nothing. */
const FLAT = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderIn(metrics: typeof NOTCHED, ui: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

describe('Screen', () => {
  it('pays for the status bar, which is the bug it exists to prevent', async () => {
    await renderIn(
      NOTCHED,
      <Screen>
        <Text>Alpha Public School</Text>
      </Screen>,
    );

    expect(screen.getByTestId('screen-safe-area')).toHaveStyle({ paddingTop: NOTCHED.insets.top });
  });

  it('leaves the bottom to the tab bar on a tab screen', async () => {
    // Not a detail. React Navigation's tab bar adds the bottom inset for itself, so a tab
    // screen that added it too would leave a 34pt gap of canvas above the tab bar on every
    // notched iPhone — the same class of defect as the one this component fixes, in the
    // other direction.
    await renderIn(
      NOTCHED,
      <Screen edges={TAB_SCREEN_EDGES}>
        <Text>Cart</Text>
      </Screen>,
    );

    expect(screen.getByTestId('screen-safe-area')).toHaveStyle({
      paddingTop: NOTCHED.insets.top,
      paddingBottom: 0,
    });
  });

  it('takes the home indicator on a stack screen, which has no tab bar under it', async () => {
    await renderIn(
      NOTCHED,
      <Screen edges={STACK_SCREEN_EDGES}>
        <Text>Dish</Text>
      </Screen>,
    );

    expect(screen.getByTestId('screen-safe-area')).toHaveStyle({
      paddingTop: NOTCHED.insets.top,
      paddingBottom: NOTCHED.insets.bottom,
    });
  });

  it('adds nothing on a device with no insets', async () => {
    // The frame must be invisible where it is not needed. A constant 47pt of padding would
    // pass the first test in this file and be wrong on every Android handset without a
    // cutout, which is most of the audience.
    await renderIn(
      FLAT,
      <Screen>
        <Text>Home</Text>
      </Screen>,
    );

    expect(screen.getByTestId('screen-safe-area')).toHaveStyle({
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it('carries the canvas into the inset strip', async () => {
    // `S7`: the strip above the content is part of the screen. If it were left transparent
    // the status-bar area would show the navigator's background, which is a visible band on
    // any screen whose own background is not the default.
    await renderIn(
      NOTCHED,
      <Screen>
        <Text>Account</Text>
      </Screen>,
    );

    expect(screen.getByTestId('screen-safe-area')).toHaveStyle({
      backgroundColor: design.bg.canvas,
    });
  });

  it('renders what it wraps', async () => {
    await renderIn(
      NOTCHED,
      <Screen>
        <Text>Bravo International School</Text>
      </Screen>,
    );

    expect(screen.getByText('Bravo International School')).toBeOnTheScreen();
  });
});

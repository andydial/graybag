import { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { design } from '@graybag/shared';

const { bg } = design;

/**
 * The safe-area frame every screen renders inside.
 *
 * ## What this fixes, and why no test caught it
 *
 * The first real iOS build put the school picker's first row on top of the clock and the
 * cart's empty-state heading through the status icons. `SafeAreaProvider` had been mounted
 * in `App.tsx` since `E14-01` and `Sheet` already read `useSafeAreaInsets` — but **nothing
 * consumed the top inset**, and every screen in the navigator runs `headerShown: false`.
 * A header is what usually pays for the status bar without anyone noticing; with no header
 * and no inset, content starts at y=0, which on a notched iPhone is underneath the clock.
 *
 * Android hid it. `edgeToEdgeEnabled` draws behind the system bars too, but Android's status
 * bar is a thin translucent strip over a light background, so overlap reads as "sits a bit
 * high" rather than as text through a clock. The bug was always there on both platforms.
 *
 * Not caught by 865 tests because every test rendered a screen **in isolation**, where the
 * question "does anything pay for the inset" is not asked of anybody. `Screen.test.tsx`
 * asks it of this component and `RootNavigator.test.tsx` asks it of every route, which is
 * the level the defect actually lives at.
 *
 * ## Why the edges are a parameter and not a constant
 *
 * A screen inside the tab navigator must **not** take the bottom inset: React Navigation's
 * tab bar already sits above the home indicator and adds it for itself, so a screen that
 * added it too would leave a second gap the height of the indicator above the tab bar.
 * A screen pushed on the stack has no tab bar under it and does need it. That difference is
 * declared once per registration site in `RootNavigator`, where it is visible, rather than
 * inferred here from something this component cannot see.
 *
 * ## Why `useSafeAreaInsets` and explicit padding, not `SafeAreaView`
 *
 * Same reason `Sheet` gives: the insets are a number this component adds to a box it already
 * owns. It also makes the result assertable — the padding is on a view with a known `testID`,
 * so the test can state the actual guarantee ("the top of the content is below the status
 * bar") rather than "a `SafeAreaView` is present somewhere in the tree", which is a test of
 * the wiring rather than of the outcome.
 */
export type ScreenEdge = 'top' | 'bottom' | 'left' | 'right';

/** What a screen sitting under the tab bar takes. The bottom belongs to the tab bar. */
export const TAB_SCREEN_EDGES: readonly ScreenEdge[] = ['top', 'left', 'right'];

/** What a screen pushed on the stack takes. Nothing below it pays for the home indicator. */
export const STACK_SCREEN_EDGES: readonly ScreenEdge[] = ['top', 'bottom', 'left', 'right'];

export const SCREEN_TEST_ID = 'screen-safe-area';

export function Screen({
  children,
  edges = TAB_SCREEN_EDGES,
  style,
  testID = SCREEN_TEST_ID,
}: {
  children: ReactNode;
  edges?: readonly ScreenEdge[];
  style?: ViewStyle;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={testID}
      style={[
        styles.root,
        {
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
          paddingLeft: edges.includes('left') ? insets.left : 0,
          paddingRight: edges.includes('right') ? insets.right : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // `bg.canvas` here as well as on the screen inside it: the inset strip is part of the
  // screen and must not be a different colour from the content it sits above. Without it the
  // status-bar area would be whatever the navigator's background happens to be, which is a
  // visible band on any screen whose own background is not the default.
  root: { flex: 1, backgroundColor: bg.canvas },
});

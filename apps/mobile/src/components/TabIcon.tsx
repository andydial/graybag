import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { design } from '@graybag/shared';

const { icon, space } = design;

/**
 * A bottom-tab icon (`E14-16`).
 *
 * ## What was there before
 *
 * Nothing. `RootNavigator` set `tabBarIcon` on the Cart tab only — and that one returned the
 * badge, which is `null` at zero — so all four tabs fell through to React Navigation's own
 * default glyph, a filled triangle. On the first iOS build that is what a parent saw: four
 * triangles. It was never a placeholder we wrote and meant to replace; there was no icon set
 * in the project at all.
 *
 * ## The set
 *
 * **Lucide**, which `docs/design-tokens.md` §7 already chose — ISC licence, a consistent
 * 24px grid, and the outline style the mocks are drawn in. `icon.size.lg` (24) is the only
 * size permitted in the tab bar and `icon.stroke.default` (1.75) is its weight, both read
 * from the tokens rather than written here.
 *
 * ## The active state, and a deliberate divergence from §7
 *
 * §7 says the active state is "a fill, not a different icon". The second half holds — the
 * same glyph is drawn either way. The first half does not, and the reason is a property of
 * Lucide rather than a preference: its glyphs are **open stroked paths**, not closed shapes.
 * Filling `UtensilsCrossed` does not produce a solid version of the icon, it produces a blob
 * where the strokes happen to enclose area. Some glyphs (`User`, `House`) survive it and some
 * do not, so a blanket fill would make the tab bar inconsistent in a way that only shows up
 * on a device.
 *
 * The active state is therefore **colour plus weight** — `nav.itemActive` at
 * `icon.stroke.large`. That keeps §7's actual requirement, which is §2.10's: the state must
 * not be carried by colour alone, because deuteranopia is roughly 6% of Indian men. Two
 * signals, neither of them a different icon.
 *
 * Recorded as decision `S39`. If a filled set is wanted later it is a swap of this file, not
 * of its callers.
 *
 * ## Accessibility
 *
 * The glyph is decorative and says so. React Navigation already announces the tab as
 * "Menu, tab, 2 of 4" from the label; an icon that also announced itself would make every
 * tab two stops for one destination.
 *
 * The badge is **not** inside that hidden wrapper, because it is the one thing in the bar
 * that carries state. It is also not enough on its own: React Navigation's tab button is an
 * accessible element, and an accessible element's children are not separately announced on
 * iOS. So the count reaches a screen-reader user through the tab's own
 * `tabBarAccessibilityLabel` — "Cart, 2 items" — which `RootNavigator` sets from the cart.
 * That is §7's rule that state lives in the label rather than in the colour, and the badge
 * is the sighted half of the same signal.
 */
export function TabIcon({
  glyph: Glyph,
  focused,
  color,
  trailing,
  testID,
}: {
  glyph: LucideIcon;
  focused: boolean;
  /** Supplied by React Navigation from `tabBarActiveTintColor` / `tabBarInactiveTintColor`. */
  color: string;
  /** Drawn over the icon's top-right corner. The cart badge, and nothing else so far. */
  trailing?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.root} testID={testID}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Glyph
          size={icon.size.lg}
          color={color}
          strokeWidth={focused ? icon.stroke.large : icon.stroke.default}
        />
      </View>
      {trailing !== undefined ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: icon.size.lg,
    height: icon.size.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The badge overlaps the icon's top-right rather than sitting beside it: the tab bar has
  // four fixed columns and a badge that widened the icon would shift the label under it.
  trailing: {
    position: 'absolute',
    top: -space[2],
    left: space[3],
  },
});

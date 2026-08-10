import { useNavigation } from '@react-navigation/native';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { design } from '@graybag/shared';

const { bg, text, space, radius, touchTarget } = design;

/**
 * A way back, on every stack screen.
 *
 * ## Why this exists at all
 *
 * Every route in this app runs `headerShown: false`, because each screen draws its own title
 * in the brand's voice rather than in React Navigation's. That was a deliberate design choice
 * and it quietly removed the **only** back affordance in the product: Dish detail and Add
 * someone were both reachable and both had no visible way out. On Android the hardware back
 * gesture saves you; on iOS the edge swipe usually does, but "usually" is doing a lot of work
 * for a parent halfway through adding their child.
 *
 * ## Why it lives in `withScreenFrame` rather than in each screen
 *
 * Same reasoning as the safe-area inset that wrapper already applies, and the same failure it
 * already prevented once: fixing this screen by screen fixes the screens that exist and leaves
 * the defect waiting for the next one. Applied at registration, a stack route **cannot** be
 * added without a way back, because there is nowhere else to add one.
 *
 * Tab screens do not get it — a tab is not somewhere you came *from*.
 *
 * It is deliberately just the chevron: the screens already draw their own titles, and a second
 * title bar above them would be a duplicate rather than a header.
 */
export function BackBar({ testID = 'back-bar' }: { testID?: string }) {
  const navigation = useNavigation();

  // A route reached as the first screen in a stack has nothing to go back to. Drawing a
  // chevron that does nothing is worse than drawing none.
  if (!navigation.canGoBack()) return null;

  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => navigation.goBack()}
        testID={testID}
        accessibilityRole="button"
        // "Back" alone is what a screen reader announces on every screen in every app; naming
        // the action is more use than naming the direction.
        accessibilityLabel="Go back"
        hitSlop={space[2]}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <ChevronLeft size={space[6]} color={text.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: space[2], paddingTop: space[2], backgroundColor: bg.surface },
  button: {
    width: touchTarget.min,
    height: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  pressed: { backgroundColor: bg.surfaceMuted },
});

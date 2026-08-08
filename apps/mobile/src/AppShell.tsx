import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

const { bg, text, scale, layout, space } = design;

/**
 * The app shell.
 *
 * `E14-01` scaffolds it as a single screen so the token pipeline is proven end to end —
 * `packages/shared/src/design` → this component → a rendered tree — before navigation
 * (`E14-03`) or any real screen is built on top. `E14-03` replaces the body with the tab
 * navigator; this file stays as the one place that decides what sits above it.
 *
 * Every value below comes from a semantic role, never a ramp step (`S7`). That is what
 * makes a future dark mode a second mapping file rather than a rewrite, and it is what
 * lets `E13-13`'s contrast test reason about this screen at all.
 */
export function AppShell() {
  return (
    <View style={styles.root} testID="app-shell">
      <Text style={styles.title}>GrayBag</Text>
      <Text style={styles.subtitle}>
        Ordering school lunches, without the flying bird.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: bg.canvas,
    padding: layout.gutter,
    gap: space[3],
  },
  title: {
    color: text.primary,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
  },
  subtitle: {
    color: text.secondary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
    fontWeight: scale.body.weight,
    textAlign: 'center',
  },
});

import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

const { bg, text, scale, layout, space } = design;

/**
 * A screen that exists in the navigation graph and has no content yet.
 *
 * `E14-03` builds the *structure* — which routes exist, which are reachable without a
 * session, where the tab bar sits. The screens themselves are `E14-14` (rebuilt to the
 * design system) and `E04-12` (menu browse and search). Standing them up as placeholders
 * rather than stubs-with-a-TODO means the navigation tests assert real mounts and real
 * accessibility labels, and the routing is provably right before any of it is dressed.
 */
export function PlaceholderScreen({
  title,
  note,
  testID,
}: {
  title: string;
  note: string;
  testID: string;
}) {
  return (
    <View style={styles.root} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.note}>{note}</Text>
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
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
  },
  note: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    fontWeight: scale.bodySm.weight,
    textAlign: 'center',
  },
});

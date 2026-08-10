import { StyleSheet, View } from 'react-native';
import { design } from '@graybag/shared';

import { EmptyState } from '../components/Surfaces';

const { bg, layout } = design;

/**
 * A screen that exists in the navigation graph and has no content yet.
 *
 * `E14-03` builds the *structure* — which routes exist, which are reachable without a
 * session, where the tab bar sits. The screens themselves are `E14-14` (rebuilt to the
 * design system) and `E04-12` (menu browse and search). Standing them up as placeholders
 * rather than stubs-with-a-TODO means the navigation tests assert real mounts and real
 * accessibility labels, and the routing is provably right before any of it is dressed.
 *
 * ## What it says, and who it says it to (`E14-17`)
 *
 * The first iOS build shipped **build notes** to a phone. "Browsable signed out." "Never a
 * wall — the tab still opens." Both are true, both are things the team needed to agree, and
 * neither means anything to a parent holding the device — the second one reads as a warning
 * about something.
 *
 * A screen with no content still has to be readable by the person in front of it. So the
 * copy now says what will be here, in the second person, in words a parent uses — and says
 * it as a **future**, because the screen genuinely is not built and pretending otherwise
 * would be the other way to be confusing. The constraints the old notes recorded (`AR7`,
 * `D7`) live in the comments at each call site, where they were always meant to be.
 *
 * `EmptyState` rather than a bare title and paragraph: "there is nothing here yet" is exactly
 * what that component is for, and using it means these screens are already made of the design
 * system when `E14-14` replaces their content rather than their frame.
 */
export function PlaceholderScreen({
  title,
  body,
  testID,
}: {
  /** A heading a parent would recognise, not a route name. */
  title: string;
  /** What will be on this screen, in the second person and in the future tense. */
  body: string;
  testID: string;
}) {
  return (
    <View style={styles.root} testID={testID}>
      <EmptyState title={title} body={body} />
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
  },
});

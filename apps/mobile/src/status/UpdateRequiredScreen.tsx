import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { BrandPanel, Lockup } from '../components';
import { Button } from '../components/Button';
import { NON_ROUTE_SCREENS } from '../analytics/screens';
import { useScreenView } from '../analytics/useScreenView';

const { text, space, scale, layout } = design;

/**
 * "You need a newer GrayBag" — `E17-46`.
 *
 * The mandatory parent update on 19 August is a store listing and an email unless something in
 * the product enforces it. This screen is the enforcement, and where it sits matters: **the app
 * blocks, the server reports.**
 *
 * A server that hard-refused every call from an old build would produce the same outcome by a
 * worse route — the first parent to meet it would be one mid-order on the morning of the
 * cutover, whose cart fails with a network error and who has no idea why. Refusing here means we
 * can say what happened and hand them the store.
 *
 * ## It is a dead end on purpose, and that is unusual here
 *
 * Every other terminal screen in this app offers a way onward — `EmptyState` takes an action,
 * `ErrorState` requires a retry, and §5.21 is explicit that a control which disappears and a
 * control that never existed look identical. **This one deliberately does not**, because there
 * genuinely is no way onward inside this build: the schema it knows about has moved. Offering
 * "continue anyway" would be offering a path we know is broken.
 *
 * What it does offer is the store, which is the only real exit.
 *
 * ## The sentence comes from the server when there is one
 *
 * `platform_config.update_required_message` overrides the default, so the wording on the 19th can
 * change without a deploy — which is the whole point of the floor being data. The default must
 * always be present: an empty dialog is worse than a generic one, and a config row that has not
 * been given a message must not produce one.
 *
 * No store URL is hard-coded for iOS beyond the scheme: the App Store id is not known to this
 * repository (`E17-33` is still open on the Play `versionName`, and the iOS id has never been
 * written down here). `Linking.openURL` with a search URL reaches the listing without inventing
 * an id that would silently open the wrong app.
 *
 * ## `Linking` directly, with no injectable seam
 *
 * An `openStore` prop was the first shape and `orphans.test.ts` correctly refused it: nothing but
 * a test would ever pass one, and an optional prop only tests use is indistinguishable from a
 * caller somebody forgot to wire. `SupportScreen` made the same call for the same reason. The
 * test mocks `Linking`, so the path under test is the path that ships.
 */
export function UpdateRequiredScreen({
  /** `platform_config.update_required_message`. `null` uses the default below. */
  message = null,
  /** The floor the server compared against. Shown only as a diagnostic, never as the ask. */
  minimumVersion = null,
  testID = 'screen-update-required',
}: {
  message?: string | null;
  minimumVersion?: string | null;
  testID?: string;
} = {}) {
  useScreenView(NON_ROUTE_SCREENS.updateRequired);

  return (
    <View style={styles.root} testID={testID}>
      <BrandPanel>
        <Lockup />
      </BrandPanel>

      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          Time to update GrayBag
        </Text>

        <Text style={styles.lead} testID={`${testID}-message`}>
          {message ??
            'This version of GrayBag is too old to order with. Update to the latest version and ' +
              'everything will be where you left it — your children, your orders and your invoices.'}
        </Text>

        <Button label="Update GrayBag" onPress={openStore} testID={`${testID}-store`} />

        {/*
          A diagnostic, not the ask. A parent does not act on a version number, but a support
          conversation is much shorter when the screenshot carries one. No user data of any kind
          appears on this screen (`R6`) — it renders before anyone has signed in.
        */}
        {minimumVersion === null ? null : (
          <Text style={styles.note} testID={`${testID}-minimum`}>
            {`Needs version ${minimumVersion} or newer.`}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Open the store listing.
 *
 * A **search** URL rather than a direct product link, because neither store id is recorded in
 * this repository — `E17-33` is open on the Play `versionName` and the App Store id has never
 * been written down. A guessed id opens the wrong app silently, which is worse than one extra
 * tap; a search for the app name lands on it.
 */
function openStore(): void {
  const url =
    Platform.OS === 'ios'
      ? 'itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=GrayBag'
      : 'market://search?q=GrayBag&c=apps';
  void Linking.openURL(url).catch(() => {
    // The store scheme is unavailable — a simulator, or a device without Play. The https form
    // works everywhere a browser does, and failing silently here would leave the only exit dead.
    void Linking.openURL(
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/search?term=GrayBag'
        : 'https://play.google.com/store/search?q=GrayBag&c=apps',
    );
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: design.bg.canvas },
  body: { padding: layout.gutter, gap: space[3] },
  title: {
    color: text.primary,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
  },
  lead: {
    color: text.secondary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  note: {
    color: text.tertiary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },
});

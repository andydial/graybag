import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

const { text, space, scale } = design;

/**
 * Which build is this, in words, on screen.
 *
 * ## Why it exists
 *
 * Andy has twice reported a bug from a binary neither of us could identify afterwards — once
 * from a build that predated the fix being discussed, once from a preview build he believed
 * was a dev client. Both cost hours, and both were unanswerable after the fact because
 * **nothing in the app said what it was**.
 *
 * A screenshot of the Account screen now answers it: environment and the commit the binary was
 * built from. `app.config.js` stamps both into `extra` — from `EAS_BUILD_GIT_COMMIT_HASH` on
 * EAS, from `git rev-parse` locally.
 *
 * ## Why it is not hidden in production
 *
 * The obvious instinct is to render it only when `__DEV__`. That would remove it from exactly
 * the builds whose identity is hardest to establish — a TestFlight or internal-distribution
 * build weeks after the fact. A seven-character commit hash tells an attacker nothing that the
 * public repository does not, and the value of always being able to say "you were on `394dd2f`"
 * is worth far more than the nothing it gives away.
 *
 * It is deliberately quiet: caption-sized, secondary colour, at the foot of one screen.
 *
 * ## No PII, ever
 *
 * Environment and commit only. Never a user id, never an email, never a school (R6). This is a
 * label about the *binary*, not about whoever is holding it.
 */
export function BuildLabel({ testID = 'build-label' }: { testID?: string }) {
  const extra = Constants.expoConfig?.extra ?? {};
  const appEnv = typeof extra.appEnv === 'string' ? extra.appEnv : 'unknown';
  const gitSha = typeof extra.gitSha === 'string' ? extra.gitSha : 'unknown';

  // The label a person reads, not the variable's value: "local" on a home screen icon called
  // "GrayBag Dev" is one more thing to translate in your head at the moment you least want to.
  const label = { production: 'Production', staging: 'Staging', local: 'Dev' }[appEnv] ?? appEnv;

  return (
    <View style={styles.wrap}>
      <Text style={styles.text} testID={testID} selectable>
        {label} · {gitSha}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space[3], alignItems: 'center' },
  // `selectable` above and a tappable-sized row here: the point is that it can be read off a
  // screenshot, and copied when a screenshot is not to hand.
  text: { color: text.secondary, fontSize: scale.caption.size },
});

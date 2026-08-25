import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { analyticsOffReason } from '../analytics/analytics';

const { text, space, scale } = design;

/**
 * Which JS the binary is actually running — the half `gitSha` cannot answer.
 *
 * `gitSha` is stamped at **build** time, so it never moves when an OTA lands. A build showing
 * `Production · 394dd2f` is showing the commit its *binary* came from, whether the JS on top of
 * it is that commit's or a bundle published half an hour ago. Without this, "did the update
 * apply?" is unanswerable from the device, which makes an OTA something you hope happened.
 */
export interface BuildIdentity {
  /** `false` in Expo Go and dev clients, where none of the rest means anything. */
  enabled: boolean;
  /** `true` when running the JS baked into the binary rather than a downloaded update. */
  embedded: boolean;
  /** The update's uuid, or `null` when running embedded. */
  updateId: string | null;
}

/**
 * Read it defensively. Every field here is optional at runtime depending on how the binary was
 * built, and a diagnostic label is the last thing that should be able to crash a screen.
 */
export function readBuildIdentity(): BuildIdentity {
  try {
    return {
      enabled: Updates.isEnabled === true,
      embedded: Updates.isEmbeddedLaunch !== false,
      updateId: typeof Updates.updateId === 'string' ? Updates.updateId : null,
    };
  } catch {
    return { enabled: false, embedded: true, updateId: null };
  }
}

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
/**
 * The label, as a string. Pure, so the interesting part is testable without a renderer and
 * without a test-only prop on the component — `orphans.test.ts` is right to refuse one, and it
 * refused this exact prop when it was tried.
 */
export function buildLabelText(
  label: string,
  gitSha: string,
  build: BuildIdentity,
  /**
   * `E15-20`. A short warning when something that should be running is not — today only
   * "analytics off", meaning a **production** bundle with no PostHog key.
   *
   * On the label rather than in a log because a `console.error` on a phone is read by nobody,
   * and this is the line Andy already looks at to check an OTA landed.
   */
  warning: string | null = null,
): string {
  /**
   * The OTA segment, and it is omitted rather than faked when updates are off.
   *
   * In Expo Go and dev clients `isEnabled` is false and none of the update fields mean
   * anything; printing "bundled" there would be a true statement that reads as a claim about
   * an update channel that is not running.
   *
   * Seven characters, like the commit beside it — enough to match against `eas update:list`
   * and short enough to read off a photograph of a phone.
   */
  const ota = !build.enabled
    ? null
    : build.embedded || build.updateId === null
      ? 'bundled'
      : `OTA ${build.updateId.slice(0, 7)}`;

  return `${label} · ${gitSha}${ota === null ? '' : ` · ${ota}`}${warning === null ? '' : ` · ⚠ ${warning}`}`;
}

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
        {buildLabelText(label, gitSha, readBuildIdentity(), analyticsOffReason())}
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

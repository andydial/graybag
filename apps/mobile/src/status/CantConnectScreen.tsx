import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { BrandPanel, Lockup } from '../components';
import { Button } from '../components/Button';
import { NON_ROUTE_SCREENS } from '../analytics/screens';
import { useScreenView } from '../analytics/useScreenView';

const { text, space, scale, radius, layout } = design;

/**
 * "We can't reach GrayBag" — `E21-17`, `docs/ux-spec.md` §5.20.
 *
 * ## Why this screen exists at all
 *
 * `configureApiFromEnvironment()` deliberately lets the app open without a backend client, so a
 * parent never meets a stack trace. That is right. But nothing then *told* anyone, so every
 * screen failed in its own way and an unconfigured build looked like an empty menu —
 * indistinguishable from "this school hasn't published one".
 *
 * That is not hypothetical. It is exactly what happened on 2026-08-10: a working staging
 * environment read as a data problem for three hours, because the app had one sentence for two
 * completely different situations. This screen is the second sentence.
 *
 * ## What it must never say
 *
 * **Never "check your connection" when the problem is ours.** An unconfigured build is a build
 * problem; telling someone to restart their router over it wastes their evening and hides ours.
 * The copy leads with "this is us, not you" and — the part that matters most — says explicitly
 * that it is *not* the school's menu, because that is the wrong conclusion a reader is most
 * likely to draw after the last two screens they saw.
 *
 * ## The diagnostics block
 *
 * Environment name and the missing variables, **outside production only**. It is the difference
 * between a screenshot that tells us the answer and one that starts a conversation. It carries
 * no user data of any kind — variable names, never values (`R6`).
 */
export function CantConnectScreen({
  /** Names of the environment variables that are missing, if that is why. */
  missing = [],
  /** The environment this build was made for. Rendered only when `showDiagnostics`. */
  appEnv = null,
  /** False in production builds. */
  showDiagnostics = false,
  onRetry,
  testID = 'screen-cant-connect',
}: {
  missing?: readonly string[];
  appEnv?: string | null;
  showDiagnostics?: boolean;
  onRetry?: () => void;
  testID?: string;
}) {
  useScreenView(NON_ROUTE_SCREENS.cantConnect);

  return (
    <BrandPanel radius={radius.none} style={styles.panel} testID={testID}>
      <View style={styles.body}>
        <Lockup height={space[10]} white />

        <Text style={styles.title} accessibilityRole="header">
          We can&rsquo;t reach GrayBag
        </Text>
        <Text style={styles.lead}>
          This is us, not you — and it isn&rsquo;t your school&rsquo;s menu. Nothing you&rsquo;ve
          done is lost. Try again in a moment.
        </Text>
      </View>

      <View style={styles.actions}>
        {onRetry === undefined ? null : (
          <Button label="Try again" variant="secondary" onPress={onRetry} testID={`${testID}-retry`} />
        )}

        {showDiagnostics && (missing.length > 0 || appEnv !== null) ? (
          <View style={styles.diagnostics} testID={`${testID}-diagnostics`}>
            <Text style={styles.diagnosticsHead}>this build</Text>
            {appEnv === null ? null : <Text style={styles.diagnosticsLine}>{appEnv}</Text>}
            {missing.map((name) => (
              // Names, never values. A screenshot of this screen must be safe to paste anywhere.
              <Text key={name} style={styles.diagnosticsLine}>
                {name} — missing
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </BrandPanel>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, justifyContent: 'space-between', padding: layout.gutter },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3] },
  // Large and semibold only: white on the brand green passes for large text and not for body
  // copy, so nothing here drops to `scale.body` on the green.
  title: {
    color: text.onBrand,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
    textAlign: 'center',
  },
  lead: {
    color: text.onBrand,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
    textAlign: 'center',
  },
  actions: { gap: space[3] },
  diagnostics: { borderRadius: radius.md, padding: space[3], gap: space[1] },
  diagnosticsHead: {
    color: text.onBrand,
    fontSize: scale.overline.size,
    fontWeight: scale.overline.weight,
    letterSpacing: scale.overline.size * scale.overline.tracking,
    textTransform: 'uppercase',
  },
  diagnosticsLine: { color: text.onBrand, fontSize: scale.caption.size },
});

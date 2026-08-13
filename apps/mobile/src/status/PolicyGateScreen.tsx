import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button } from '../components/Button';

const { bg, text, border, space, scale, radius, borderWidth, layout } = design;

/**
 * The policy-version acceptance gate — `E21-16`, `docs/ux-spec.md` §5.19.
 *
 * ## It blocks writes, never browsing
 *
 * This is the whole design. `AR7` says nothing may be a wall in front of the menu, so a parent
 * whose accepted policy version is out of date can still open the app, browse, and fill a cart.
 * What they cannot do is place an order — the first *write* routes through here, and then
 * resumes the thing they were doing.
 *
 * "Not now — keep browsing" is therefore a real, supported answer, not a courtesy. Removing it
 * would turn this into the wall.
 *
 * ## Why it summarises rather than reprints
 *
 * A parent asked to re-accept a policy they have already accepted needs to know **what
 * changed**, not to re-read four pages. `policy_version.summary_of_changes` exists for this.
 * Reprinting the whole document is how consent screens become things people tap through, and a
 * consent nobody read is worth nothing to them or to us.
 */
export function PolicyGateScreen({
  /** From `policy_version.summary_of_changes`. */
  summary,
  onAccept,
  onNotNow,
  accepting = false,
  error = null,
  testID = 'screen-policy-gate',
}: {
  summary: string;
  onAccept?: () => void;
  onNotNow?: () => void;
  accepting?: boolean;
  error?: string | null;
  testID?: string;
}) {
  return (
    <View style={styles.screen} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        We&rsquo;ve updated our privacy policy
      </Text>
      <Text style={styles.lead}>
        You can keep browsing — we only need this before your next order.
      </Text>

      <View style={styles.summary} testID={`${testID}-summary`}>
        <Text style={styles.summaryHead}>What changed</Text>
        <Text style={styles.summaryBody}>{summary}</Text>
      </View>

      {error === null ? null : (
        <Text style={styles.error} testID={`${testID}-error`}>
          {error}
        </Text>
      )}

      <View style={styles.actions}>
        <Button
          label={accepting ? 'Saving…' : 'Accept and continue'}
          onPress={() => onAccept?.()}
          disabled={accepting || onAccept === undefined}
          testID={`${testID}-accept`}
        />
        {/* A real answer, not a courtesy — see the note above. */}
        <Button
          label="Not now — keep browsing"
          variant="secondary"
          onPress={() => onNotNow?.()}
          disabled={onNotNow === undefined}
          testID={`${testID}-not-now`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas, padding: layout.gutter, gap: space[3] },
  title: { color: text.primary, fontSize: scale.h1.size, lineHeight: scale.h1.lineHeight, fontWeight: scale.h1.weight },
  lead: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
  summary: {
    backgroundColor: bg.surface,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    borderRadius: radius.lg,
    padding: space[4],
    gap: space[2],
  },
  summaryHead: { color: text.primary, fontSize: scale.label.size, fontWeight: scale.label.weight },
  summaryBody: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
  error: { color: text.danger, fontSize: scale.caption.size },
  actions: { marginTop: 'auto', gap: space[3] },
});

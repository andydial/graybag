import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

const { text, space, scale, border, borderWidth, radius } = design;

/**
 * Why *this* screen is empty, in facts, on the screen — `E14-31`.
 *
 * ## Why it exists
 *
 * `BuildLabel` was added because two bug reports were chased against the wrong binary. It worked:
 * a screenshot now answers "which build". This is the same instrument pointed at data.
 *
 * Andy has reported an empty menu on four consecutive days. Each time a check of mine passed —
 * PostgREST returns 47 rows, the app's own `api` module parses 47 dishes, the images fetch 200 —
 * and each time his screen showed nothing. The disagreement always lived in a layer neither of us
 * could see from where we were standing: my checks stop at the api module, his screenshot starts
 * at the pixels, and the cache, the school id in play and the row count actually received all sit
 * in between. Four rounds of reasoning could not close a gap that one line of on-screen text
 * closes immediately.
 *
 * So: when a screen has nothing to show, it says what it asked for and what came back.
 *
 * ## The §5.21 argument, which is the more important one
 *
 * `docs/ux-spec.md` §5.21 says an unknown must never render as a known, and enumerates four
 * different emptinesses: N1 nothing here, N2 we could not ask, N3 you cannot see this, N4 stale
 * cache. The app distinguishes them in its *copy*, and that is right for a parent — but the copy
 * is deliberately reassuring and therefore erases the detail an engineer needs. A screen that
 * cannot say **why** it is empty is that rule failing quietly, one audience further along.
 *
 * ## Not in production
 *
 * Unlike `BuildLabel`, this one is gated. `BuildLabel` prints a commit hash, which the public
 * repository already gives away; this prints school ids and cache tokens, which describe *this
 * user's* data and belong to nobody but us. Non-production builds only — `appEnv !== 'production'`
 * rather than `__DEV__`, so it survives into the preview and staging builds where these arguments
 * actually happen.
 *
 * ## Never PII (R6, non-negotiable #4)
 *
 * Ids, counts, versions and enum values. **Never a name, never a class, never an allergen, never
 * an email, never a dish a particular child was looking at.** A diagnostic that leaks a minor's
 * name into a screenshot pasted in a chat is a worse defect than the one it was added to solve.
 * The `rows` figure is a count, and counts describe the query, not the person.
 */
export interface Diagnostic {
  /** Short label. Keep it to a word or two — this is read at a glance in a screenshot. */
  label: string;
  /** A fact. Ids, counts, enum values. Never anything about a person. */
  value: string | number | null;
}

export function EmptyStateDiagnostic({
  facts,
  testID = 'empty-diagnostic',
}: {
  facts: readonly Diagnostic[];
  testID?: string;
}) {
  const extra = Constants.expoConfig?.extra ?? {};
  const appEnv = typeof extra.appEnv === 'string' ? extra.appEnv : 'unknown';
  if (appEnv === 'production') return null;
  if (facts.length === 0) return null;

  return (
    <View style={styles.panel} testID={testID}>
      <Text style={styles.heading}>Diagnostic · {appEnv}</Text>
      {facts.map((fact) => (
        <Text key={fact.label} style={styles.row} testID={`${testID}-${slug(fact.label)}`}>
          {/*
            "—" rather than an omitted row: an absent value is itself the answer some of the
            time, and a row that vanishes cannot be distinguished in a screenshot from a row
            that was never added.
          */}
          {fact.label}: {fact.value === null || fact.value === '' ? '—' : String(fact.value)}
        </Text>
      ))}
    </View>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const styles = StyleSheet.create({
  panel: {
    marginTop: space[4],
    padding: space[3],
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    borderRadius: radius.sm,
    gap: space[1],
  },
  heading: { color: text.secondary, fontSize: scale.caption.size, fontWeight: scale.h3.weight },
  // Monospace so an id can be read off a photograph of a screen without transcription errors.
  row: { color: text.secondary, fontSize: scale.caption.size, fontFamily: 'monospace' },
});

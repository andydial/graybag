import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button } from './Button';

const {
  bg, text, border, scale, space, radius, borderWidth, layout, touchTarget,
} = design;

/**
 * Card, list row, empty state, error state and skeleton — the surfaces the rest of the app
 * is assembled from (`E13-03`).
 *
 * Two rules run through all of them:
 *
 * **`S5`: skeletons for every first load, no spinners.** On an unreliable connection a
 * skeleton shows the *shape* of what is coming, which reads as progress; a spinner reads as a
 * stall. The rule that makes it work is geometric — a skeleton's boxes must match the real
 * content's boxes exactly, so nothing shifts when the data lands.
 *
 * **Empty states and error states are the two deliberate non-skeletons.** They are real
 * compositions with a heading, an explanation and usually an action, because "there is
 * nothing here" and "this failed" are things to say, not shapes to imply.
 */

export function Card({
  children,
  onPress,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  if (onPress === undefined) {
    return (
      <View style={styles.card} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {children}
    </Pressable>
  );
}

export function ListRow({
  title,
  subtitle,
  trailing,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle !== undefined ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );

  if (onPress === undefined) return <View testID={testID}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      // One label for the whole row. A screen reader reading "Veg Sandwich" then "Rs 60"
      // then "button" as three stops is three times the work for the same information.
      accessibilityLabel={subtitle === undefined ? title : `${title}, ${subtitle}`}
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * A skeleton block. Static — **no shimmer in the back office** (`S9`), and the shimmer
 * elsewhere is `M03`, which owns the only `linear` easing in the system.
 *
 * Sized by the caller so it matches the real content's box. A skeleton that is roughly the
 * right size is worse than none: the content jumps when it lands, and a jump is the thing
 * skeletons exist to prevent.
 */
export function Skeleton({
  width,
  height,
  testID,
}: {
  width: number | `${number}%`;
  height: number;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[styles.skeleton, { width, height }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    />
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  testID = 'empty-state',
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.state} testID={testID}>
      <Text style={styles.stateTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.stateBody}>{body}</Text>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" />
      ) : null}
    </View>
  );
}

/**
 * An error state.
 *
 * `onRetry` is required rather than optional on purpose. An error with no way forward is a
 * dead end, and on the connections this product targets almost every error is transient —
 * "try again" is the correct affordance far more often than it is not. A screen that
 * genuinely cannot retry should use `EmptyState` with an explanation instead of an error.
 */
export function ErrorState({
  title = 'Something went wrong',
  body,
  onRetry,
  testID = 'error-state',
}: {
  title?: string;
  body: string;
  onRetry: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.state} testID={testID}>
      <Text style={styles.stateTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.stateBody}>{body}</Text>
      <Button label="Try again" onPress={onRetry} variant="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: bg.surface,
    borderRadius: radius.lg,
    padding: layout.cardPadding,
    // No shadow. `elevation[0]` is the documented default for cards, rows and sections —
    // they are "differentiated by fill", not by depth. A shadow here would be a fourth way
    // of saying "this is a distinct thing" on a surface that already says it twice.
  },
  cardPressed: { backgroundColor: bg.surfaceMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: touchTarget.min,
    paddingVertical: layout.listRowPaddingY,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: border.subtle,
  },
  rowText: { flex: 1, gap: space[1] },
  rowTitle: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  rowSubtitle: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  skeleton: { backgroundColor: bg.surfaceMuted, borderRadius: radius.sm },
  state: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    padding: layout.gutter,
  },
  stateTitle: {
    color: text.primary,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
    textAlign: 'center',
  },
  stateBody: {
    color: text.secondary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
    textAlign: 'center',
  },
});

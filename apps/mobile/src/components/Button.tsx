import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

const { action, bg, scale, space, radius, touchTarget, opacity } = design;

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

/**
 * The button.
 *
 * Three things here are rules rather than styling choices:
 *
 * **The fill is `action.primaryBg` = `primary-700`, not the brand `#00af52`.** That is `S6`,
 * the 500 rule: white on `#00af52` is 2.90:1 and fails even the 3:1 a control boundary needs.
 * The brand's own Colour Usage Guide says `#00AF52` is for "Buttons & CTAs", so this is a
 * documented deviation from the brand guideline rather than a correction to the mocks —
 * `DS-01`, approved via `E13-14`.
 *
 * **The touch target is 48×48 minimum** (`touchTarget.min`), which is the stricter of iOS's 44
 * and Android's 48 taken once rather than per-platform. Visual size and target size are
 * separate concerns; where they differ the visual shrinks and `hitSlop` holds the target.
 *
 * **There is no spinner replacing the label.** `S5` bans spinners; a loading button keeps its
 * label and adds a small indicator, so the control does not change size and the user does not
 * lose the word they were reading.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Both, deliberately. `disabled` is what a screen reader announces; `busy` is what
      // distinguishes "not available" from "working on it", and a user who cannot see the
      // indicator has no other way to tell them apart.
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        inert && styles.inert,
        pressed && !inert && pressedStyles[variant],
      ]}
    >
      <View style={styles.content}>
        <Text style={[styles.label, labelStyles[variant], inert && styles.inertLabel]}>
          {label}
        </Text>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === 'secondary' ? action.secondaryFg : action.primaryFg}
            // The label already says what is happening; announcing the indicator too would
            // repeat it.
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget.min,
    paddingHorizontal: space[5],
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  label: {
    fontSize: scale.button.size,
    lineHeight: scale.button.lineHeight,
    fontWeight: scale.button.weight,
  },
  // No opacity on the disabled state. `action.disabledBg`/`disabledFg` are contrast-checked
  // as a pair; dimming them further would push a token that passes below the bar it passed,
  // which is how a disabled control becomes unreadable rather than merely unavailable.
  inert: { backgroundColor: action.disabledBg },
  inertLabel: { color: action.disabledFg },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: action.primaryBg },
  secondary: { backgroundColor: action.secondaryBg },
  destructive: { backgroundColor: action.destructiveBg },
});

const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: action.primaryBgPressed },
  secondary: { backgroundColor: bg.surfaceMuted },
  destructive: { backgroundColor: action.destructiveBg, opacity: opacity.pressed },
});

const labelStyles = StyleSheet.create({
  primary: { color: action.primaryFg },
  secondary: { color: action.secondaryFg },
  destructive: { color: action.destructiveFg },
});

/** Exported for the a11y test, so the 48pt floor is asserted rather than assumed. */
export const BUTTON_MIN_HEIGHT = touchTarget.min;

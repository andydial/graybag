import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { design } from '@graybag/shared';

const {
  action, bg, text, border, scale, space, radius, borderWidth, touchTarget, icon,
} = design;

/**
 * A checkbox with its label (`E13-03`, built for `E05-01`).
 *
 * ## Why it exists now and not before
 *
 * Nothing in the product needed one until consent. Every other control is a button, a field
 * or a row — and a consent tick is none of those: it has to be **deliberate, separable and
 * recorded**, which is exactly what a checkbox is for and what a toggle is not. A toggle
 * reads as a preference that can be flipped back; a consent is an act with a date on it.
 *
 * ## The whole row is the target
 *
 * `touchTarget.min` (48) is on the row, not on the box, and the label is inside the same
 * `Pressable`. A 20px box next to unpressable text is the commonest way a consent question
 * becomes annoying to answer, and an annoying consent question is one people tick without
 * reading — which is worse for us than a slow one.
 *
 * ## Accessibility
 *
 * `accessibilityRole="checkbox"` with `accessibilityState.checked`, so a screen reader
 * announces the state and the fact that it is changeable. **The tick is decorative** —
 * `checked` is already in the state, and an icon that also announced itself would say it
 * twice.
 *
 * `required` puts the word "required" in the accessible label rather than relying on the
 * asterisk convention, which is a visual idiom a screen reader does not carry.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  description,
  required = false,
  disabled = false,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The sentence under the label. Where the "what for" of a consent question belongs. */
  description?: string;
  required?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={required ? `${label}, required` : label}
      {...(description === undefined ? {} : { accessibilityHint: description })}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View
        style={[
          styles.box,
          checked && styles.boxChecked,
          disabled && styles.boxDisabled,
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {checked ? (
          <Check size={icon.size.md} color={bg.canvas} strokeWidth={icon.stroke.large} />
        ) : null}
      </View>

      <View style={styles.textColumn}>
        <Text style={[styles.label, disabled && styles.labelDisabled]}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {description !== undefined ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    minHeight: touchTarget.min,
    paddingVertical: space[2],
  },
  rowPressed: { backgroundColor: bg.surfaceMuted },
  box: {
    width: touchTarget.visualSmall,
    height: touchTarget.visualSmall,
    borderRadius: radius.sm,
    borderWidth: borderWidth.emphasis,
    borderColor: border.strong,
    backgroundColor: bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    // Nudged so the box sits on the label's first line rather than on the middle of a
    // two-line block. A consent question is usually two lines.
    marginTop: space[1],
  },
  boxChecked: { backgroundColor: action.primaryBg, borderColor: action.primaryBg },
  // Colour, never opacity (`S37`): the disabled pair is contrast-checked, and dimming it
  // would push a token that passes below the bar it passed.
  boxDisabled: { backgroundColor: action.disabledBg, borderColor: action.disabledBg },
  textColumn: { flex: 1, gap: space[1] },
  label: {
    color: text.primary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
    fontWeight: scale.body.weight,
  },
  labelDisabled: { color: action.disabledFg },
  required: { color: text.danger },
  description: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
});

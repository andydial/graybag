import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { design } from '@graybag/shared';

import { InlineError } from './motion/InlineError';

const { bg, text, border, scale, space, radius, borderWidth, touchTarget, focus } = design;

/**
 * A labelled text input.
 *
 * **The outline is `border.strong`, not `border.default`.** `border.default` is `neutral-400`
 * at 2.28:1 on white — decorative weight, below the 3:1 WCAG 1.4.11 needs for a control
 * boundary — and an input's outline is the *only* thing marking where the control is.
 * `E13-13` asserts `border.default` as a forbidden control boundary precisely because it is
 * called "default" and is therefore the one a component reaches for (`S28`).
 *
 * The error is `InlineError` (`M10`), so it expands rather than appearing, and the content
 * below moves with it rather than jumping.
 */
export function TextField({
  label,
  value,
  onChangeText,
  error = null,
  hint,
  testID,
  ...inputProps
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  error?: string | null;
  hint?: string;
  testID?: string;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'style'>) {
  const [focused, setFocused] = useState(false);
  const invalid = error !== null && error !== '';

  return (
    <View style={styles.field} testID={testID}>
      <Text style={styles.label} nativeID={`${label}-label`}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          focused && styles.inputFocused,
          invalid && styles.inputInvalid,
        ]}
        // `placeholder` is never the label. A placeholder disappears the moment the user
        // types, so a field labelled only by its placeholder is unlabelled for anyone who
        // looks away mid-entry — and unlabelled for a screen reader from the start.
        accessibilityLabel={label}
        accessibilityLabelledBy={`${label}-label`}
        accessibilityState={{ disabled: inputProps.editable === false }}
        placeholderTextColor={text.disabled}
        {...inputProps}
      />
      {hint !== undefined && !invalid ? <Text style={styles.hint}>{hint}</Text> : null}
      <InlineError message={error} {...(testID ? { testID: `${testID}-error` } : {})} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[2] },
  label: {
    color: text.secondary,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },
  input: {
    minHeight: touchTarget.min,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.sm,
    borderWidth: borderWidth.default,
    // Not `border.default` — see the note above. This is the control boundary.
    borderColor: border.strong,
    backgroundColor: bg.surface,
    color: text.primary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  inputFocused: { borderColor: focus.ring, borderWidth: borderWidth.emphasis },
  inputInvalid: { borderColor: border.danger },
  hint: {
    color: text.tertiary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },
});

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { TextField } from '../components/TextField';

const { text, space, scale, touchTarget } = design;

/**
 * The note a parent sends to the kitchen — `P12`, and Andy's item 3 of 2026-08-11.
 *
 * ## Why it moved
 *
 * It lived only in the cart, as a full text field under every line. That is the wrong place and
 * the wrong weight: the moment a parent knows they want "no chilli" is while they are looking
 * at the dish, not three screens later while reading a total. And a permanently-open field on
 * every line makes the cart a form when it should be a receipt.
 *
 * So the field is on the **dish sheet**, where the decision is made, and the cart carries a
 * compact line that shows what was written and opens to change it.
 *
 * ## 140 characters, hard-stopped
 *
 * `P12` capped it. The stop is hard rather than a truncation on save, because a parent who
 * typed 200 characters and had 60 silently dropped believes the kitchen has all of it.
 *
 * ## What the copy promises, and refuses to
 *
 * Best effort, and nothing more — `P12`'s second condition. It is a request passed to the
 * kitchen, not a guarantee, and **explicitly not where allergies go**. Allergies are structured
 * data on the child with a warning path behind them (`D7`); a free-text "no peanuts" here reads
 * to a parent like a safety instruction and is not one.
 */
export const KITCHEN_NOTE_MAX_LENGTH = 140;

const HINT = 'Optional. A request we pass to the kitchen — not a guarantee, and not for allergies.';

/**
 * The full field. Used on the dish sheet, where there is room and where the thought occurs.
 *
 * Uncontrolled draft with a commit on blur, so a parent typing does not re-render the sheet on
 * every keystroke and the value that lands is the one they finished writing.
 */
export function KitchenNoteField({
  value,
  onCommit,
  testID = 'kitchen-note',
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
  testID?: string;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const remaining = KITCHEN_NOTE_MAX_LENGTH - draft.length;

  return (
    <TextField
      label="Note for the kitchen"
      testID={testID}
      value={draft}
      onChangeText={setDraft}
      maxLength={KITCHEN_NOTE_MAX_LENGTH}
      // Blank commits as `null`, so clearing genuinely clears rather than storing an empty
      // string the domain would have to normalise anyway.
      onBlur={() => onCommit(draft.trim() === '' ? null : draft.trim())}
      hint={remaining <= 20 ? `${remaining} characters left. ${HINT}` : HINT}
    />
  );
}

/**
 * The compact line, for the cart.
 *
 * Closed it is one row: the note if there is one, or an invitation if there is not. Open it is
 * the same field as the dish sheet — not a second implementation, because two editors for one
 * value is two sets of rules about trimming, blanking and length.
 *
 * **It collapses once the note is committed, and that is not a choice this component makes.**
 * A line's key includes its comment — a comment is part of a line's identity in the cart domain
 * — so committing re-keys the row, React unmounts this component and mounts a fresh one, and
 * `open` starts false again. The result reads correctly: you tap Add, type, tap away, and the
 * row shows what you wrote with Edit beside it. Recorded because the mechanism is not obvious
 * from the code, and someone will otherwise "fix" the collapse by hoisting the state and
 * quietly break the re-keying instead.
 */
export function KitchenNoteLine({
  value,
  onCommit,
  testID = 'kitchen-note-line',
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);

  if (open) {
    return <KitchenNoteField value={value} onCommit={onCommit} testID={`${testID}-field`} />;
  }

  return (
    <Pressable
      onPress={() => setOpen(true)}
      accessibilityRole="button"
      // The note itself is in the label, not only on screen: a screen-reader user needs to know
      // what the note currently says before deciding to edit it.
      accessibilityLabel={
        value === null ? 'Add a note for the kitchen' : `Note for the kitchen: ${value}. Edit`
      }
      style={styles.line}
      testID={testID}
    >
      <View style={styles.lineText}>
        {value === null ? (
          <Text style={styles.prompt}>Add a note for the kitchen</Text>
        ) : (
          // One line. The cart is a receipt; a note that wraps to four lines turns a line item
          // into a paragraph and pushes the total off the screen.
          <Text style={styles.note} numberOfLines={1}>
            {value}
          </Text>
        )}
      </View>
      <Text style={styles.action}>{value === null ? 'Add' : 'Edit'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touchTarget.min,
    gap: space[3],
  },
  lineText: { flexShrink: 1 },
  prompt: { color: text.secondary, fontSize: scale.caption.size },
  note: { color: text.primary, fontSize: scale.caption.size },
  action: { color: text.link, fontSize: scale.caption.size, fontWeight: scale.label.weight },
});

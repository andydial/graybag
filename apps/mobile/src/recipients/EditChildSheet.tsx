import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button } from '../components/Button';
import { TextField } from '../components';

const { text, space, scale, border, borderWidth } = design;

/**
 * Correcting a child's details, and removing them — `E05-37`.
 *
 * ## Why this matters more than it looks
 *
 * Andy, 2026-08-11: at the start of a school year **every** parent's child is in the wrong
 * class at once. With no way to edit, a parent fixes it the only way the app allows — by
 * adding the child again. That is duplicate recipients, duplicate allergy records and a
 * support queue, arriving for the whole user base in the same week.
 *
 * So the edit is not a convenience. It is the thing that stops one predictable calendar event
 * generating a duplicate for every account.
 *
 * ## Three actions, deliberately not equal
 *
 * **Correcting** a name, class or section is the ordinary one and gets the fields. **Moving**
 * schools is rarer, has a future-order guard, and resets the class — so it is a separate
 * action behind its own picker rather than a fourth field, which is `E05-43`'s whole point:
 * fixing a mistyped section used to mean pretending to move the child to the school they were
 * already at. **Removing** is destructive and irreversible and sits below a divider, apart
 * from the things that are neither.
 *
 * ## The removal confirmation says what the code actually does
 *
 * Since migration `0026` removal **erases** the child: `recipient_allergen` rows deleted, the
 * allergy note cleared, name, class and section emptied. It is not the reversible deactivation
 * it was a day ago, and the copy is written against the current behaviour rather than the old
 * comment. Andy's rule: the promise and the code are one sentence.
 *
 * It also says what is *kept*, because a parent reading "everything is deleted" and later
 * finding an invoice would be right to feel misled — and invoices are kept under a statutory
 * floor we cannot waive.
 */
export function EditChildSheet({
  /** Who is being edited. `null` closes the sheet; the caller owns that. */
  recipient,
  onSave,
  onMoveSchool,
  onRemove,
  saving = false,
  removing = false,
  error = null,
  testID = 'edit-child',
}: {
  /**
   * The row being edited. `isSelf` is required rather than optional — the caller always has
   * it, and `orphans.test.ts` reads an optional field here as a prop nothing passes, which is
   * a fair complaint: an optional flag that decides whether the copy says "you" or a child's
   * name is one nobody has to remember, and the copy quietly reads wrong if they forget.
   */
  recipient: {
    id: string;
    firstName: string;
    classLabel: string | null;
    sectionLabel: string | null;
    isSelf: boolean;
  };
  onSave: (edit: { firstName: string; classLabel: string | null; sectionLabel: string | null; clearSection: boolean }) => void;
  onMoveSchool: () => void;
  onRemove: () => void;
  saving?: boolean;
  removing?: boolean;
  /** A refusal, already turned into something a parent can act on. */
  error?: string | null;
  testID?: string;
}) {
  const [firstName, setFirstName] = useState(recipient.firstName);
  const [classLabel, setClassLabel] = useState(recipient.classLabel ?? '');
  const [sectionLabel, setSectionLabel] = useState(recipient.sectionLabel ?? '');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const who = recipient.isSelf ? 'you' : recipient.firstName;
  const trimmedName = firstName.trim();
  const busy = saving || removing;

  if (confirmingRemove) {
    return (
      <View style={styles.body} testID={`${testID}-confirm-remove`}>
        <Text style={styles.confirmTitle} accessibilityRole="header">
          Remove {who}?
        </Text>

        {/*
          Written against migration `0026`, not against what removal used to do. Each line is a
          fact the code enforces: the links are revoked for every guardian, the tier-P/S columns
          are emptied and `recipient_allergen` is deleted, and `order`/`invoice` survive because
          `D15` forbids breaking a statutory record.
        */}
        <Text style={styles.confirmBody}>
          {recipient.isSelf ? 'You' : 'They'} will be removed from your list — and from
          any other parent&rsquo;s list too.
        </Text>
        <Text style={styles.confirmBody}>
          {recipient.isSelf ? 'Your' : 'Their'} name, class and any allergy details you
          gave us are deleted. This can&rsquo;t be undone.
        </Text>
        <Text style={styles.confirmBody}>
          Past orders and invoices are kept — we&rsquo;re required to keep those.
        </Text>

        {error === null ? null : (
          <Text style={styles.error} testID={`${testID}-error`}>
            {error}
          </Text>
        )}

        <View style={styles.actions}>
          <Button
            label={removing ? 'Removing…' : `Yes, remove ${who}`}
            variant="destructive"
            onPress={onRemove}
            disabled={busy}
            testID={`${testID}-remove-confirm`}
          />
          <Button
            label="Keep them"
            variant="secondary"
            onPress={() => setConfirmingRemove(false)}
            disabled={busy}
            testID={`${testID}-remove-cancel`}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.body} testID={testID}>
      <TextField
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        testID={`${testID}-first-name`}
      />
      {/*
        Class and section are the two that go stale every July, and they are the reason this
        sheet exists. Free text rather than a picker: `class_label` is the free-text fallback
        `[DM-08]` chose, and schools do not agree on whether it is "5", "V" or "Grade 5".
      */}
      <View style={styles.pair}>
        <View style={styles.pairItem}>
          <TextField
            label="Class"
            value={classLabel}
            onChangeText={setClassLabel}
            testID={`${testID}-class`}
          />
        </View>
        <View style={styles.pairItem}>
          <TextField
            label="Section"
            value={sectionLabel}
            onChangeText={setSectionLabel}
            testID={`${testID}-section`}
          />
        </View>
      </View>

      {error === null ? null : (
        <Text style={styles.error} testID={`${testID}-error`}>
          {error}
        </Text>
      )}

      <Button
        label={saving ? 'Saving…' : 'Save changes'}
        onPress={() =>
          onSave({
            firstName: trimmedName,
            classLabel: classLabel.trim() === '' ? null : classLabel.trim(),
            sectionLabel: sectionLabel.trim() === '' ? null : sectionLabel.trim(),
            // `null` already means "leave alone" on the API, so emptying a field a parent had
            // filled in needs its own flag — otherwise a section typed by mistake could never
            // be taken away again.
            clearSection: sectionLabel.trim() === '' && (recipient.sectionLabel ?? '') !== '',
          })
        }
        disabled={busy || trimmedName === ''}
        testID={`${testID}-save`}
      />

      <Button
        label="Move to another school"
        variant="secondary"
        onPress={onMoveSchool}
        disabled={busy}
        testID={`${testID}-move-school`}
      />

      {/* Destructive, and separated. Everything above corrects a detail; this ends a record. */}
      <View style={styles.divider} />
      <Button
        label={`Remove ${who}`}
        variant="destructive"
        onPress={() => setConfirmingRemove(true)}
        disabled={busy}
        testID={`${testID}-remove`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[3] },
  pair: { flexDirection: 'row', gap: space[3] },
  pairItem: { flex: 1 },
  divider: {
    borderTopWidth: borderWidth.hairline,
    borderTopColor: border.subtle,
    marginTop: space[2],
  },
  confirmTitle: {
    color: text.primary,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
  },
  confirmBody: {
    color: text.secondary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  error: { color: text.danger, fontSize: scale.caption.size },
  actions: { gap: space[3], marginTop: space[2] },
});

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

const { text, scale, space } = design;

/**
 * The account holder's own name, changed from Account — `P18`, `E05-39`.
 *
 * ## Why this is not `NameCapture`
 *
 * They ask different questions. `NameCapture` is a **prompt**: it decides for itself whether to
 * appear, it offers "Not now", and answering it either way records that the question has been
 * put. This is an **edit**: it was opened deliberately, it starts prefilled, and there is
 * nothing here to skip — Cancel closes a sheet rather than declining anything.
 *
 * Collapsing them would mean one component whose skip is sometimes a cancel and whose "have we
 * asked" stamp is sometimes not written. That is the kind of shared component that is cheaper
 * on the day it is written and wrong on every day after.
 *
 * ## Clearing a name is allowed
 *
 * An empty field saves as "no name" rather than being refused. `P18` is explicit that order one
 * has no name and that must be fine everywhere — so a name is a thing a person may give and
 * then take back, and a form that would not let them is a form claiming we need it.
 *
 * The caller sends the clear; `set_user_name` refuses a blank first name, so this is deliberately
 * the one path that does not go through it (see `AccountScreen`'s container).
 */
export function EditNameSheet({
  initialFirstName,
  initialLastName,
  onSave,
  onCancel,
  saving = false,
  error = null,
  testID = 'edit-name',
}: {
  initialFirstName: string | null;
  initialLastName: string | null;
  onSave: (name: { firstName: string; lastName: string | null }) => void;
  onCancel: () => void;
  saving?: boolean;
  /** A refusal, already turned into something the account holder can act on. */
  error?: string | null;
  testID?: string;
}) {
  const [firstName, setFirstName] = useState(initialFirstName ?? '');
  const [lastName, setLastName] = useState(initialLastName ?? '');

  return (
    <View style={styles.body} testID={testID}>
      <Text style={styles.intro}>
        It goes on your receipts, and it is what we use if we need to contact you about an
        order. Leave it blank and we will simply not use one.
      </Text>

      <TextField
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="Priya"
        autoCapitalize="words"
        testID={`${testID}-first-name`}
      />
      <TextField
        label="Last name (optional)"
        value={lastName}
        onChangeText={setLastName}
        placeholder="Sharma"
        autoCapitalize="words"
        testID={`${testID}-last-name`}
      />

      {error === null ? null : (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {error}
        </Text>
      )}

      <Button
        label="Save"
        onPress={() =>
          onSave({
            firstName: firstName.trim(),
            lastName: lastName.trim() === '' ? null : lastName.trim(),
          })
        }
        loading={saving}
        testID={`${testID}-save`}
      />
      <Button
        label="Cancel"
        variant="secondary"
        onPress={onCancel}
        disabled={saving}
        testID={`${testID}-cancel`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[3] },
  intro: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  error: {
    color: text.danger,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
});

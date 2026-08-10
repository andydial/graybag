import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, design } from '@graybag/shared';

import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { ErrorState, Skeleton } from '../components/Surfaces';
import { Sheet } from '../components/Tabs';
import { TextField } from '../components/TextField';
import { SchoolPicker } from '../menu/SchoolPicker';

const { bg, text, scale, space, layout } = design;

/**
 * Adding a child — `E05-01`, and the consent capture `E20-02` asks for.
 *
 * ## This screen is the only place consent is given, and it gives it once
 *
 * `create_recipient` writes the child, the `guardian_link` and the `consent_record` in one
 * transaction (`C10`), so there is deliberately no "add now, consent later" path to build a
 * screen for. The tick and the child are the same request.
 *
 * ## Two questions, because they are two questions
 *
 * The required one covers name, class and section — without it there is no service to
 * provide. The allergy one is **separate and optional**, because it is health data about a
 * minor (`C12`, DPDP §13.3): a parent may use GrayBag without telling us and simply get no
 * warnings. Bundling them would make the required consent conditional on giving up
 * something optional, which is the definition of consent that is not free.
 *
 * The allergen list only appears once that second box is ticked. Not a trick — asking for
 * the details before the permission is how a form ends up holding data it was not allowed
 * to collect, and the server refuses that combination anyway (`allergen_consent_required`).
 *
 * ## Why the school defaults to the one already chosen
 *
 * A parent arriving here has almost always browsed the menu first, which means they have
 * already answered "which school" once (`SelectedSchoolContext`). Asking again is a step
 * `AR7` explicitly costs us conversions for. It is still changeable — the row opens the
 * same picker — but the default is the answer they already gave.
 */
export function AddChildScreen({
  initialSchool,
  onAdded,
  onCancel,
  appVersion,
  testID = 'screen-add-child',
}: {
  initialSchool: { schoolId: string | null; schoolName: string | null };
  onAdded: (recipient: { recipientId: string; firstName: string }) => void;
  onCancel: () => void;
  appVersion: string;
  testID?: string;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [classLabel, setClassLabel] = useState('');
  const [sectionLabel, setSectionLabel] = useState('');

  const [schoolId, setSchoolId] = useState(initialSchool.schoolId);
  const [schoolName, setSchoolName] = useState(initialSchool.schoolName);
  const [pickingSchool, setPickingSchool] = useState(false);

  const [consentGranted, setConsentGranted] = useState(false);
  const [allergenConsent, setAllergenConsent] = useState(false);
  const [allergenIds, setAllergenIds] = useState<string[]>([]);
  const [allergyNote, setAllergyNote] = useState('');

  const [allergens, setAllergens] = useState<api.ApiAllergen[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Loaded only when the parent has said we may ask. Fetching the list earlier would be
  // harmless in itself, but it is the habit that matters: the details come after the
  // permission, in the code as well as on the screen.
  useEffect(() => {
    if (!allergenConsent || allergens !== null) return;

    let live = true;
    api
      .fetchAllergens()
      .then((rows) => {
        if (live) setAllergens(rows);
      })
      .catch(() => {
        // An empty list is not an error state here — the note field still works, and a
        // parent halfway through adding a child should not be stopped by it.
        if (live) setAllergens([]);
      });

    return () => {
      live = false;
    };
  }, [allergenConsent, allergens]);

  const toggleAllergen = useCallback((id: string) => {
    setAllergenIds((current) =>
      current.includes(id) ? current.filter((a) => a !== id) : [...current, id],
    );
  }, []);

  const ready = firstName.trim() !== '' && schoolId !== null && consentGranted;

  const submit = useCallback(async () => {
    if (!ready || schoolId === null) return;
    setSubmitting(true);
    setFailure(null);

    try {
      const created = await api.createRecipient({
        firstName: firstName.trim(),
        lastName: lastName.trim() === '' ? null : lastName.trim(),
        schoolId,
        classLabel: classLabel.trim() === '' ? null : classLabel.trim(),
        sectionLabel: sectionLabel.trim() === '' ? null : sectionLabel.trim(),
        consentGranted,
        allergenConsent,
        allergenIds,
        allergyNote: allergyNote.trim() === '' ? null : allergyNote.trim(),
        screen: 'add-child',
        appVersion,
      });
      onAdded({ recipientId: created.recipientId, firstName: created.firstName });
    } catch (error) {
      // The server's refusals are sentences a parent can act on — "GrayBag is not serving
      // that school yet", "we need your permission on the allergies question". Showing the
      // message rather than a generic failure is the whole reason the codes exist.
      setFailure(
        error instanceof Error && error.message !== ''
          ? error.message
          : 'We could not add your child just now. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    ready, schoolId, firstName, lastName, classLabel, sectionLabel,
    consentGranted, allergenConsent, allergenIds, allergyNote, appVersion, onAdded,
  ]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID={testID}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title} accessibilityRole="header">
        Add a child
      </Text>
      <Text style={styles.intro}>
        We use these details to make your child’s lunch and get it to the right person.
      </Text>

      <TextField
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="The name staff will call out"
        autoCapitalize="words"
        testID={`${testID}-first-name`}
      />
      <TextField
        label="Last name (optional)"
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        testID={`${testID}-last-name`}
      />

      <View style={styles.pair}>
        <View style={styles.pairItem}>
          <TextField
            label="Class"
            value={classLabel}
            onChangeText={setClassLabel}
            placeholder="5"
            testID={`${testID}-class`}
          />
        </View>
        <View style={styles.pairItem}>
          <TextField
            label="Section"
            value={sectionLabel}
            onChangeText={setSectionLabel}
            placeholder="A"
            autoCapitalize="characters"
            testID={`${testID}-section`}
          />
        </View>
      </View>

      <Text style={styles.fieldLabel}>School</Text>
      <Button
        label={schoolName ?? 'Choose a school'}
        variant="secondary"
        onPress={() => setPickingSchool(true)}
        testID={`${testID}-school`}
      />

      <View style={styles.consent}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Your permission
        </Text>
        <Text style={styles.notice}>
          To give your child lunch we need their first name, their class and section, and
          their school. The kitchen packs by class and a member of staff hands the bag over
          by name. We do not sell this, we do not use it for advertising, and your child’s
          name never appears in the reports we give schools. You can remove your child at any
          time.
        </Text>

        <Checkbox
          label="I agree to GrayBag using these details to make and deliver my child’s meals"
          checked={consentGranted}
          onChange={setConsentGranted}
          required
          testID={`${testID}-consent`}
        />

        <Checkbox
          label="Tell GrayBag about allergies"
          description="Health information about a child, so we ask separately. You can use GrayBag without this — you just will not get allergy warnings."
          checked={allergenConsent}
          onChange={(next) => {
            setAllergenConsent(next);
            if (!next) {
              // Cleared rather than kept hidden. Details held behind an unticked box are
              // details we were told we may not have.
              setAllergenIds([]);
              setAllergyNote('');
            }
          }}
          testID={`${testID}-allergen-consent`}
        />

        {allergenConsent ? (
          <View style={styles.allergens} testID={`${testID}-allergens`}>
            {allergens === null ? (
              <Skeleton width="80%" height={scale.body.lineHeight} />
            ) : (
              allergens.map((allergen) => (
                <Checkbox
                  key={allergen.id}
                  label={allergen.displayName}
                  checked={allergenIds.includes(allergen.id)}
                  onChange={() => toggleAllergen(allergen.id)}
                  testID={`${testID}-allergen-${allergen.id}`}
                />
              ))
            )}
            <TextField
              label="Anything else we should know"
              value={allergyNote}
              onChangeText={setAllergyNote}
              placeholder="Severity, or something not on the list"
              testID={`${testID}-allergy-note`}
            />
          </View>
        ) : null}
      </View>

      {failure !== null ? (
        <ErrorState body={failure} onRetry={submit} testID={`${testID}-error`} />
      ) : null}

      <Button
        label="Add child"
        onPress={submit}
        disabled={!ready}
        loading={submitting}
        testID={`${testID}-submit`}
      />
      <Button
        label="Cancel"
        variant="secondary"
        onPress={onCancel}
        testID={`${testID}-cancel`}
      />

      <Sheet
        visible={pickingSchool}
        onDismiss={() => setPickingSchool(false)}
        title="Which school?"
        testID={`${testID}-school-sheet`}
      >
        <SchoolPicker
          testID={`${testID}-school-picker`}
          onSelect={(next) => {
            setSchoolId(next.schoolId);
            setSchoolName(next.schoolName);
            setPickingSchool(false);
          }}
        />
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { padding: layout.gutter, gap: space[4] },
  title: {
    color: text.primary,
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
  },
  intro: {
    color: text.secondary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  pair: { flexDirection: 'row', gap: space[3] },
  pairItem: { flex: 1 },
  fieldLabel: {
    color: text.primary,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },
  consent: { gap: space[3] },
  sectionTitle: {
    color: text.primary,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
  },
  notice: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  allergens: { gap: space[2], paddingLeft: space[6] },
});

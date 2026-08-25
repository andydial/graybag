import { useCallback, useEffect, useState } from 'react';
import { track } from '../analytics/analytics';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, design } from '@graybag/shared';

import { Button } from '../components/Button';
// Not from `../components` — `Checkbox` is the one component the barrel does not re-export.
// See the note in the report; `components/index.ts` is not this screen's file to edit.
import { Checkbox } from '../components/Checkbox';
import { Skeleton } from '../components/Surfaces';
import { Sheet } from '../components/Tabs';
import { TextField } from '../components/TextField';
import { InlineError } from '../components/motion/InlineError';
import { SchoolPicker } from '../menu/SchoolPicker';

const {
  bg, text, border, scale, space, layout, radius, borderWidth, touchTarget,
} = design;

/**
 * Add someone — `docs/ux-spec.md` §5.10, `E05-01`, and the consent capture `E20-02` asks for.
 *
 * ## The consent block is the screen
 *
 * Everything above the rule is a form anyone could write. The two questions below it are the
 * reason this screen exists, and they are **two questions on purpose**.
 *
 * The required one covers name, class and section — without it there is no service to
 * provide, so `create_recipient` writes the person, the `guardian_link` and the
 * `consent_record` in one transaction (`C10`). There is deliberately no "add now, agree
 * later" path to build a screen for: the tick and the person are the same request, and Save
 * being inert until it is ticked is that rule made visible rather than a validation nicety.
 *
 * The allergy one is **separate and optional**, because it is health data (`C12`, DPDP
 * §13.3): someone may use GrayBag without telling us and simply get no warnings. Bundling
 * them would make the required consent conditional on giving up something optional, which is
 * the definition of consent that is not free.
 *
 * The allergy chips only appear once that second box is ticked. Not a trick — asking for the
 * details before the permission is how a form ends up holding data it was not allowed to
 * collect, and the server refuses the combination anyway (`allergen_consent_required`).
 *
 * ## Nothing is dropped quietly
 *
 * Unticking the allergy box after typing something **clears the details and says so**
 * (`-allergy-withdrawn`). Someone who typed "peanut" and had it silently discarded would
 * believe the kitchen knows, and that belief is the actual harm this whole block exists to
 * prevent. The same goes for the server's refusal: `school_unavailable` and its siblings are
 * shown as the sentences they are, not collapsed into "something went wrong".
 *
 * ## Who it is for is asked FIRST — `E05-38`, Andy 2026-08-11
 *
 * `P13` shipped the model and the recipient-neutral copy and left the chooser as fast-follow.
 * The gap that left was not cosmetic: a member of staff arriving here found a form headed
 * "Add someone" with a Class and a Section on it, and no indication anywhere that they were
 * allowed to put themselves in it. The neutral wording removed the *contradiction*; it did not
 * answer the question.
 *
 * So the form does not exist until the question is answered. Not a toggle above a form — a
 * form that is not there yet. A toggle would have to default to something, and every default
 * here is wrong for half the people: preselecting "My child" is what made staff assume they
 * were in the wrong place, and preselecting "Myself" would have parents consenting under the
 * self notice by inertia. **`isSelf` decides which privacy notice the consent record points
 * at**, and that is not a field to be set by whichever option happened to be first.
 *
 * It is also the cheapest possible answer to "am I supposed to add myself as a child?" — the
 * confusion `E05-38` names. The question is asked, so it cannot be guessed wrong.
 *
 * The choice stays changeable afterwards, and changing it **clears the class and section**
 * rather than hiding them: a form that keeps "Class 5" in state while showing a staff member
 * is a form one refactor away from sending it.
 *
 * ## Recipient-neutral copy (`P13`)
 *
 * An adult may add **themselves** — school staff and college students order their own lunch.
 * So this is "Add someone", and once the question above is answered every string speaks to the
 * answer: "their name" for a child, "your name" for an adult. Nothing here infers a
 * relationship it was not told about.
 *
 * ## Why the school defaults to the one already chosen
 *
 * Someone arriving here has almost always browsed the menu first, which means they have
 * already answered "which school" once (`SelectedSchoolContext`). Asking again is a step
 * `AR7` explicitly costs us registrations for. It stays changeable — the row opens the same
 * picker — but the default is the answer they already gave, and the hint says where it came
 * from rather than leaving a prefilled field looking like a guess.
 *
 * ## Nothing on this screen may be logged
 *
 * Name, class, section and allergies are tier P/S personal data (non-negotiable #4). There is
 * no `console` call in this file and there must never be one; a failure message carries a
 * code or an index, never a name.
 */
/**
 * Who the food is for. `null` until asked — see the header; it is not a defaultable field.
 */
export type Audience = 'child' | 'self';

export function AddChildScreen({
  initialSchool,
  initialAudience = null,
  onAdded,
  onCancel,
  appVersion,
  offline = false,
  testID = 'screen-add-child',
}: {
  initialSchool: { schoolId: string | null; schoolName: string | null };
  /**
   * Skips the question when it has already been answered elsewhere — "Order for myself" on the
   * list arrives with `'self'` (`E05-38`). Answering the same question twice in two screens is
   * the friction `AR7` counts in lost registrations.
   *
   * Still changeable on the screen, because arriving by the wrong door is not the same as
   * having decided.
   */
  initialAudience?: Audience | null;
  onAdded: (recipient: { recipientId: string; firstName: string }) => void;
  onCancel: () => void;
  appVersion: string;
  /**
   * §5.10's offline state. Saving records a consent — who agreed, to which wording, from
   * which build — so there is no honest offline queue for it: a consent written from a
   * cached form minutes later is evidence of a tick nobody can date. Save is disabled and
   * the screen says why rather than accepting a press it cannot honour.
   */
  offline?: boolean;
  testID?: string;
}) {
  const [audience, setAudience] = useState<Audience | null>(initialAudience);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [classLabel, setClassLabel] = useState('');
  const [sectionLabel, setSectionLabel] = useState('');

  const [schoolId, setSchoolId] = useState(initialSchool.schoolId);
  const [schoolName, setSchoolName] = useState(initialSchool.schoolName);
  // True only while the school is the one they were browsing. Once they pick another, the
  // hint that explains where it came from stops being true and stops being shown.
  const [schoolPrefilled, setSchoolPrefilled] = useState(initialSchool.schoolId !== null);
  const [pickingSchool, setPickingSchool] = useState(false);

  const [consentGranted, setConsentGranted] = useState(false);
  const [allergenConsent, setAllergenConsent] = useState(false);
  const [allergenIds, setAllergenIds] = useState<string[]>([]);
  const [allergyNote, setAllergyNote] = useState('');
  const [withdrawn, setWithdrawn] = useState(false);

  const [allergens, setAllergens] = useState<api.ApiAllergen[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<{ title: string; advice: string | null } | null>(null);

  // Per-field, inline, and only after a save has actually been attempted (§5.10 *Invalid*).
  // Marking a field red before anyone has finished typing in it is a scold, not a hint.
  const [nameError, setNameError] = useState<string | null>(null);
  const [schoolError, setSchoolError] = useState<string | null>(null);

  // Loaded only once the second box is ticked. Fetching the list earlier would be harmless in
  // itself, but it is the habit that matters: the details come after the permission, in the
  // code as well as on the screen.
  useEffect(() => {
    if (!allergenConsent || allergens !== null) return;

    let live = true;
    api
      .fetchAllergens()
      .then((rows) => {
        if (live) setAllergens(rows);
      })
      .catch(() => {
        // An empty list is not an error state here — the note field still works, and someone
        // halfway through adding a person should not be stopped by it.
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

  const changeFirstName = useCallback((next: string) => {
    setFirstName(next);
    // Clears as soon as it is fixed. An error that outlives its cause reads as one the
    // screen cannot see you have answered.
    if (next.trim() !== '') setNameError(null);
  }, []);

  const changeAllergenConsent = useCallback(
    (next: boolean) => {
      setAllergenConsent(next);
      if (next) {
        setWithdrawn(false);
        return;
      }
      // Cleared rather than kept hidden — details held behind an unticked box are details we
      // were told we may not have. Said out loud, because the whole point of asking
      // separately is that someone knows exactly what we do and do not hold.
      setWithdrawn(allergenIds.length > 0 || allergyNote.trim() !== '');
      setAllergenIds([]);
      setAllergyNote('');
    },
    [allergenIds, allergyNote],
  );

  /**
   * Answer — or change — who this is for.
   *
   * **Clears the class and the section on the way to `'self'`.** An adult has neither (`0022`),
   * and the two fields are unmounted rather than hidden, so anything left in their state would
   * be invisible and still in the request. `createRecipient` drops them for a self recipient
   * too; the two together are belt and braces on a field that would put "Class 5" against a
   * member of staff.
   */
  const chooseAudience = useCallback((next: Audience) => {
    setAudience(next);
    if (next === 'self') {
      setClassLabel('');
      setSectionLabel('');
    }
  }, []);

  const chooseSchool = useCallback((next: { schoolId: string; schoolName: string }) => {
    setSchoolId(next.schoolId);
    setSchoolName(next.schoolName);
    setSchoolPrefilled(false);
    setSchoolError(null);
    setPickingSchool(false);
  }, []);

  const isSelf = audience === 'self';

  // Save is disabled for the three things a press could not fix: no consent, no connection,
  // and a save already in flight. A missing name or school leaves it **enabled** and answers
  // with an inline message on the field, which is where the fix is.
  const blocked = !consentGranted || offline || saved;

  const submit = useCallback(async () => {
    if (blocked || submitting || audience === null) return;

    const missingName = firstName.trim() === '';
    const missingSchool = schoolId === null;
    setNameError(
      missingName
        ? isSelf
          ? 'We need your first name — it is what staff read off the list when they hand the bag over.'
          : 'We need a first name — it is what staff read off the packing list when they hand the bag over.'
        : null,
    );
    setSchoolError(
      missingSchool
        ? isSelf
          ? 'Choose where you will be collecting your lunch.'
          : 'Choose the school where they will be eating.'
        : null,
    );
    if (missingName || missingSchool || schoolId === null) return;

    setSubmitting(true);
    setFailure(null);

    try {
      const created = await api.createRecipient({
        firstName: firstName.trim(),
        lastName: lastName.trim() === '' ? null : lastName.trim(),
        schoolId,
        classLabel: classLabel.trim() === '' ? null : classLabel.trim(),
        sectionLabel: sectionLabel.trim() === '' ? null : sectionLabel.trim(),
        isSelf,
        consentGranted,
        allergenConsent,
        allergenIds,
        allergyNote: allergyNote.trim() === '' ? null : allergyNote.trim(),
        // The consent record's own account of where it was taken (§11.5). The two screens are
        // one component, but they are two different wordings agreed to, and a consent log that
        // cannot say which was shown is a consent log that cannot answer the only question
        // anyone will ask of it.
        screen: isSelf ? 'add-self' : 'add-child',
        appVersion,
      });
      setSaved(true);
      /**
       * `E15-20`. **No properties.** Not the school, not the class, not how many children this
       * parent now has — every one of those is an attribute of a child, and the funnel question
       * is only whether the step happened. `checkEvent` refuses them anyway; this is the call
       * site agreeing with the rule rather than testing it.
       */
      track('child_added');
      onAdded({ recipientId: created.recipientId, firstName: created.firstName });
    } catch (error) {
      setFailure(describeFailure(error, isSelf));
    } finally {
      setSubmitting(false);
    }
  }, [
    blocked, submitting, audience, isSelf, schoolId, firstName, lastName, classLabel,
    sectionLabel, consentGranted, allergenConsent, allergenIds, allergyNote, appVersion, onAdded,
  ]);

  const saveLabel = offline
    ? 'You’re offline'
    : saved
      ? 'Added'
      : consentGranted
        ? 'Save'
        : 'Agree above to continue';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID={testID}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title} accessibilityRole="header">
        Add someone
      </Text>
      <Text style={styles.intro}>So the right food reaches the right person.</Text>

      {/*
        The question, and until it is answered there is no form under it. See the header: this
        is not a toggle with a default, because `isSelf` decides which privacy notice the
        consent record points at and no default is right for half the people who arrive here.
      */}
      {audience === null ? (
        <View style={styles.audience} testID={`${testID}-audience`}>
          <Text style={styles.fieldLabel} accessibilityRole="header">
            Who is this for?
          </Text>
          <AudienceOption
            label="My child"
            description="They’re at a school GrayBag serves, and the food goes to their classroom at break."
            onPress={() => chooseAudience('child')}
            testID={`${testID}-audience-child`}
          />
          <AudienceOption
            label="Myself"
            description="You’re staff, or a college student, ordering your own lunch."
            onPress={() => chooseAudience('self')}
            testID={`${testID}-audience-self`}
          />
        </View>
      ) : (
        <>
          {/* Answered, and still changeable. The answer is stated rather than implied by which
              fields are on screen — "there is no Class box" is not something anyone reads as
              "you told us this is for you". */}
          <View style={styles.chosen} testID={`${testID}-audience-chosen`}>
            <Text style={styles.chosenText}>
              {isSelf ? 'Adding yourself' : 'Adding your child'}
            </Text>
            <Pressable
              onPress={() => chooseAudience(isSelf ? 'child' : 'self')}
              accessibilityRole="button"
              accessibilityLabel={
                isSelf ? 'Change to adding your child' : 'Change to adding yourself'
              }
              hitSlop={space[2]}
              testID={`${testID}-audience-change`}
            >
              <Text style={styles.chosenAction}>Change</Text>
            </Pressable>
          </View>

          <View style={styles.fields}>
            <TextField
              label={isSelf ? 'Your first name' : 'First name'}
              value={firstName}
              onChangeText={changeFirstName}
              placeholder={isSelf ? 'Priya' : 'Aarav'}
              autoCapitalize="words"
              error={nameError}
              testID={`${testID}-first-name`}
            />
            <TextField
              label={isSelf ? 'Your last name (optional)' : 'Last name (optional)'}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Sharma"
              autoCapitalize="words"
              testID={`${testID}-last-name`}
            />

            <PickerField
              label={isSelf ? 'Where you’ll collect it' : 'School'}
              value={schoolName}
              placeholder="Choose a school"
              hint={
                schoolPrefilled
                  ? 'Taken from the menu you were browsing. Tap to change.'
                  : 'Tap to change the school.'
              }
              error={schoolError}
              onPress={() => setPickingSchool(true)}
              testID={`${testID}-school`}
            />

            {/*
              Unmounted for an adult, not disabled and not merely hidden. `0022`: "No class or
              section is required. A staff member has neither." A greyed-out Class box would
              still be a Class box on a screen that has just been told there is no class.
            */}
            {isSelf ? null : (
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
            )}
          </View>
        </>
      )}

      {audience === null ? null : (
        <>
      <View style={styles.rule} />

      {/*
        The consent block. Two questions, and the second one is not a detail of the first —
        see the header comment. The reason lives *under* each tick rather than in a policy
        link, because a permission whose purpose is one tap away is a permission nobody read.

        **The wording follows the answer to "who is this for".** It is not politeness: the tick
        is evidence of what somebody agreed to, and `create_recipient` records it against
        `self_data_notice` or `child_data_notice` accordingly (`0022`). A label mentioning a
        class to someone who has no class describes a consent nobody gave.
      */}
      <View style={styles.consent} testID={`${testID}-consent-block`}>
        <Checkbox
          label={
            isSelf
              ? 'I agree to GrayBag holding my name and where I collect my lunch'
              : 'I agree to GrayBag holding this person’s name, class and section'
          }
          description={
            isSelf
              ? 'We need it to get the right meal to the right person. Nothing else, and never shared with anyone but the kitchen.'
              : 'We need it to get the right meal to the right person. Nothing else, and never shared with anyone but the school kitchen.'
          }
          checked={consentGranted}
          onChange={setConsentGranted}
          required
          testID={`${testID}-consent`}
        />

        <Checkbox
          label={
            isSelf
              ? 'Also hold my allergy details (optional)'
              : 'Also hold their allergy details (optional)'
          }
          // The same sentence either way — it is about the data, and health data is health
          // data whoever it belongs to.
          description="This is health information, so we ask separately. Without it GrayBag still works — we just can’t warn you when a dish contains something."
          checked={allergenConsent}
          onChange={changeAllergenConsent}
          testID={`${testID}-allergen-consent`}
        />

        {allergenConsent ? (
          <View style={styles.allergens} testID={`${testID}-allergens`}>
            <Text style={styles.fieldLabel}>Allergies</Text>
            {allergens === null ? (
              <Skeleton width="80%" height={touchTarget.min} testID={`${testID}-allergens-loading`} />
            ) : (
              <View style={styles.chips}>
                {allergens.map((allergen) => (
                  <Chip
                    key={allergen.id}
                    label={allergen.displayName}
                    selected={allergenIds.includes(allergen.id)}
                    onPress={() => toggleAllergen(allergen.id)}
                    testID={`${testID}-allergen-${allergen.id}`}
                  />
                ))}
              </View>
            )}
            <TextField
              label="Anything else we should know"
              value={allergyNote}
              onChangeText={setAllergyNote}
              placeholder="e.g. mild lactose intolerance, or something not on the list"
              multiline
              numberOfLines={3}
              testID={`${testID}-allergy-note`}
            />
          </View>
        ) : null}

        {withdrawn ? (
          <Notice
            tone="warning"
            title="Allergy details removed"
            body="We can only hold them while that box is ticked, so what you typed was cleared and none of it was sent. Tick it again to enter them."
            testID={`${testID}-allergy-withdrawn`}
          />
        ) : null}
      </View>

      {failure !== null ? (
        <Notice
          tone="danger"
          title={failure.title}
          body={failure.advice}
          testID={`${testID}-error`}
        />
      ) : null}

      {saved ? (
        <Notice
          tone="neutral"
          title="Added"
          body={
            isSelf
              ? 'You’re on your own list — you can order for yourself now.'
              : 'They’re on your list — you can order for them now.'
          }
          testID={`${testID}-saved`}
        />
      ) : null}

      <View style={styles.actions}>
        <Button
          label={saveLabel}
          onPress={submit}
          disabled={blocked}
          loading={submitting}
          testID={`${testID}-submit`}
        />

        {/*
          The button says *that* it is blocked; this says why in a sentence. `polite` because
          it appears in response to something the user did, and a screen reader user gets no
          other signal that the button below has changed meaning.
        */}
        {offline ? (
          <Text
            style={styles.blockedReason}
            accessibilityLiveRegion="polite"
            testID={`${testID}-offline`}
          >
            You’re offline. Saving records the permission you gave and the exact wording you
            were shown, so it needs a connection. Nothing you have typed will be lost.
          </Text>
        ) : !consentGranted ? (
          <Text
            style={styles.blockedReason}
            accessibilityLiveRegion="polite"
            testID={`${testID}-consent-required`}
          >
            {isSelf
              ? 'We can’t add you until you agree to us holding your name and where you collect.'
              : 'We can’t add anyone until you agree to us holding their name, class and section.'}
          </Text>
        ) : null}
      </View>
        </>
      )}

      {/* Outside the fragment: the way out has to exist before the question is answered too.
          Somebody who opened this screen by accident must not have to answer "who is this
          for?" to leave it. */}
      <View style={styles.actions}>
        <Button
          label="Cancel"
          variant="secondary"
          onPress={onCancel}
          testID={`${testID}-cancel`}
        />
      </View>

      <Sheet
        visible={pickingSchool}
        onDismiss={() => setPickingSchool(false)}
        title="Which school?"
        testID={`${testID}-school-sheet`}
      >
        <SchoolPicker
          // Embedded in a sheet that already has its own title — the welcome panel belongs
          // only on the standalone screen (§6.1.1 cut 1).
          welcome={false} testID={`${testID}-school-picker`} onSelect={chooseSchool} />
      </Sheet>
    </ScrollView>
  );
}

/**
 * The server's refusals, turned into a heading and a next step.
 *
 * **The title is the server's own sentence, never a rewrite of it.** The Edge Function maps
 * each guard hint to something a person can act on, and a client that replaced those with its
 * own copy would have two places to keep in step and would drift. What is added here is the
 * *advice* — what to do about it — which the server has no business deciding.
 */
const REFUSAL_ADVICE: Record<string, string> = {
  school_unavailable:
    'We’re adding schools across Mohali. We’ll email you the moment yours is live — nothing you have typed is lost.',
  consent_required: 'Tick the first box above, then save again.',
  allergen_consent_required:
    'Tick the allergies box to let us hold them, or clear the allergy details and save without them.',
  first_name_required: 'Add a first name and save again.',
  no_notice_published: 'This one is on us, not on you. Try again in a minute.',
  recipient_not_found: 'Start again from your list.',
  /**
   * `E05-38` / `0022`: one adult cannot be two self-recipients. The list hides "Order for
   * myself" once one exists, so arriving here means a race between two devices or a screen
   * that was open before the first one saved — in both cases the thing they wanted is already
   * true, and the advice says where it is rather than what went wrong.
   */
  self_recipient_exists: 'Go back to your list — you’re already on it.',
};

function describeFailure(
  error: unknown,
  /** Which wording the fallback takes. The mapped refusals are the server's own sentences. */
  isSelf = false,
): { title: string; advice: string | null } {
  const code = error instanceof api.ApiError ? error.code : undefined;
  const message = error instanceof Error && error.message !== '' ? error.message : null;
  const fallbackTitle = isSelf
    ? 'We could not add you just now.'
    : 'We could not add them just now.';

  if (code !== undefined && code in REFUSAL_ADVICE) {
    return {
      title: message ?? fallbackTitle,
      advice: REFUSAL_ADVICE[code] ?? null,
    };
  }

  // Anything unmapped — a network drop, a 500. Save is still live, so the retry is the
  // button rather than a second one saying the same thing in a different place.
  return {
    title: message ?? fallbackTitle,
    advice: 'Check your connection and tap Save again.',
  };
}

/**
 * One answer to "who is this for" — `E05-38`.
 *
 * A pressable card rather than a radio, because choosing it moves the screen on rather than
 * setting a value that something else will later submit. A radio implies a form around it that
 * is not there yet, and a pair of radios implies one of them is already selected.
 *
 * The description is part of the accessible label rather than a hint: "you're staff, or a
 * college student" is the whole reason a member of staff knows this option is theirs, and a
 * hint is not announced by every screen reader in every mode.
 */
function AudienceOption({
  label,
  description,
  onPress,
  testID,
}: {
  label: string;
  description: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${description}`}
      style={({ pressed }) => [styles.audienceOption, pressed && styles.pickerPressed]}
    >
      <Text style={styles.audienceLabel}>{label}</Text>
      <Text style={styles.audienceDescription}>{description}</Text>
    </Pressable>
  );
}

/**
 * A field that opens a picker instead of a keyboard.
 *
 * Drawn as a field rather than as a button because it **is** one — it sits in a column of
 * fields, holds a value, and carries a hint and an error like its neighbours. A secondary
 * button here reads as an action among inputs, and the prefilled school then looks like
 * something you have to go and do rather than an answer already given.
 */
function PickerField({
  label,
  value,
  placeholder,
  hint,
  error,
  onPress,
  testID,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  hint: string;
  error: string | null;
  onPress: () => void;
  testID: string;
}) {
  const invalid = error !== null && error !== '';

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={value === null ? `${label}, ${placeholder}` : `${label}, ${value}`}
        accessibilityHint={hint}
        style={({ pressed }) => [
          styles.picker,
          invalid && styles.pickerInvalid,
          pressed && styles.pickerPressed,
        ]}
      >
        <Text style={value === null ? styles.pickerPlaceholder : styles.pickerValue}>
          {value ?? placeholder}
        </Text>
      </Pressable>
      {!invalid ? <Text style={styles.hint}>{hint}</Text> : null}
      <InlineError message={error} testID={`${testID}-error`} />
    </View>
  );
}

/**
 * An allergen chip.
 *
 * `accessibilityRole="checkbox"` rather than `button`, because that is what it is: one of a
 * set, each independently on or off. A row of buttons announces nothing about which are
 * chosen, and "which of these did I tick" is the only question anyone asks of this control.
 *
 * Selection is carried by fill **and** by the announced state, never by colour alone.
 */
function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A tinted block with a bold lead line and a paragraph — the shape §5.10's refusals and
 * confirmations take.
 *
 * `bg.surfaceWarning` / `text.warning` and `bg.surfaceDanger` / `text.danger` are the pairs
 * `contrast.ts` asserts legal together (`E13-17`); the neutral one is `bg.surfaceMuted` with
 * ordinary ink, because "this worked" is not a warning and must not look like one.
 */
function Notice({
  tone,
  title,
  body,
  testID,
}: {
  tone: 'danger' | 'warning' | 'neutral';
  title: string;
  body: string | null;
  testID: string;
}) {
  return (
    <View style={[styles.notice, noticeTone[tone]]} testID={testID} accessibilityLiveRegion="polite">
      <Text style={[styles.noticeTitle, noticeInk[tone]]} accessibilityRole="header">
        {title}
      </Text>
      {body !== null ? <Text style={[styles.noticeBody, noticeInk[tone]]}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { padding: layout.gutter, gap: space[4], paddingBottom: space[10] },
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
    marginTop: -space[2],
  },

  // "Who is this for?" — `E05-38`. Two cards, not a row of chips: this is the first decision
  // on the screen and it gets the width to carry a sentence under each option.
  audience: { gap: space[3] },
  audienceOption: {
    minHeight: touchTarget.min,
    gap: space[1],
    padding: space[4],
    backgroundColor: bg.surface,
    borderRadius: radius.lg,
    borderWidth: borderWidth.hairline,
    borderColor: border.strong,
  },
  audienceLabel: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  audienceDescription: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  // The answer, once given, with a way back to the question.
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    minHeight: touchTarget.min,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: bg.surfaceMuted,
  },
  chosenText: {
    flexShrink: 1,
    color: text.primary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    fontWeight: scale.label.weight,
  },
  chosenAction: {
    color: text.link,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },

  fields: { gap: space[4] },
  field: { gap: space[2] },
  fieldLabel: {
    color: text.secondary,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },
  hint: {
    color: text.tertiary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },
  pair: { flexDirection: 'row', gap: space[3] },
  pairItem: { flex: 1 },

  // Deliberately the same box as `TextField`'s input — same height, radius and boundary — so
  // the school sits in the column rather than interrupting it. `border.strong`, not
  // `border.default`: this is a control boundary and `default` is 2.28:1 (`S28`).
  picker: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.sm,
    borderWidth: borderWidth.default,
    borderColor: border.strong,
    backgroundColor: bg.surface,
  },
  pickerPressed: { backgroundColor: bg.surfaceMuted },
  pickerInvalid: { borderColor: border.danger },
  pickerValue: {
    color: text.primary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  pickerPlaceholder: {
    color: text.disabled,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },

  // The one rule on the screen. It is not decoration: it marks where the form stops and the
  // permission starts, which is the only division on this screen that matters.
  rule: { borderTopWidth: borderWidth.hairline, borderTopColor: border.subtle },

  consent: { gap: space[2] },
  allergens: { gap: space[3], paddingLeft: space[10], paddingTop: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: borderWidth.emphasis,
    borderColor: border.subtle,
    backgroundColor: bg.surface,
  },
  chipPressed: { backgroundColor: bg.surfaceMuted },
  chipSelected: { backgroundColor: bg.surfaceAccent, borderColor: border.accent },
  chipLabel: {
    color: text.primary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  chipLabelSelected: {
    color: text.onAccent,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },

  notice: { padding: layout.cardPadding, borderRadius: radius.lg, gap: space[1] },
  noticeTitle: {
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  noticeBody: { fontSize: scale.bodySm.size, lineHeight: scale.bodySm.lineHeight },

  actions: { gap: space[3] },
  blockedReason: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    textAlign: 'center',
  },
});

const noticeTone = StyleSheet.create({
  danger: { backgroundColor: bg.surfaceDanger },
  warning: { backgroundColor: bg.surfaceWarning },
  neutral: { backgroundColor: bg.surfaceMuted },
});

const noticeInk = StyleSheet.create({
  danger: { color: text.danger },
  warning: { color: text.warning },
  neutral: { color: text.primary },
});

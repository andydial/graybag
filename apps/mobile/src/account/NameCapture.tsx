import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, design } from '@graybag/shared';

import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

const { bg, text, scale, space, radius, layout } = design;

/**
 * "What should we call you?" — `P18`, `E05-39`.
 *
 * ## Where it is, and why not at checkout
 *
 * Andy, 2026-08-11, overruling both of my proposals (checkout, and the OTP success moment):
 * **the ORDER CONFIRMED screen, after payment.** Checkout is the most fragile screen in the
 * funnel and the one place friction is paid for in lost orders; nothing actually breaks without
 * a name, so there is no reason to risk the payment moment for a field we can collect thirty
 * seconds later. Here the money is taken, the parent is pleased, and they are doing nothing.
 *
 * ## It decides for itself whether to appear
 *
 * The component reads the profile and renders **nothing** unless there is no name and no record
 * of having asked (`api.shouldAskForName`). Mounting is therefore unconditional — a caller
 * cannot forget the "have we already asked" check, because there is no version of this
 * component that skips it.
 *
 * The cost is one small read on the confirmation screen. It fails closed: a read that errors
 * renders nothing at all, because the failure mode of guessing wrong is asking a parent for a
 * name we already print on their invoice.
 *
 * ## Skipping does not wait
 *
 * "Not now" dismisses immediately and lets the write settle behind it. Making somebody watch a
 * spinner in order to *decline* a question would be worse than the question. If that write
 * fails they are asked once more, which is exactly the state they were already in — so there is
 * nothing to report and nothing to retry.
 *
 * **Saving does wait**, and that asymmetry is the point: they typed something, and a field that
 * clears itself while the request is in flight cannot tell them it failed.
 *
 * ## Nothing here is required
 *
 * `P18`, in Andy's words: *order one has no name and that must be fine everywhere.* There is no
 * validation beyond "not blank", no surname requirement, and no path where dismissing this
 * blocks anything. Anything downstream that looks broken without a name is a defect to report,
 * not a reason to make this required.
 */
export function NameCapture({ testID = 'name-capture' }: { testID?: string }) {
  const [ask, setAsk] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .fetchProfile()
      .then((profile) => {
        if (live) setAsk(api.shouldAskForName(profile));
      })
      // Fails closed. Asking somebody for a name we may already hold is worse than not asking.
      .catch(() => {
        if (live) setAsk(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(async () => {
    const name = firstName.trim();
    // Blank is a skip in everything but name — there is nothing to save and nothing to say
    // about it, so it takes the same exit rather than raising "please enter a name" at somebody
    // who has just told us they would rather not.
    if (name === '') {
      setAsk(false);
      void api.skipNamePrompt().catch(() => {});
      return;
    }

    setSaving(true);
    setFailure(null);
    try {
      await api.setUserName({ firstName: name });
      setAsk(false);
    } catch {
      // The message is ours, not the server's: a backend message can quote the value it
      // refused, and the value here is somebody's name (§13.3, tier A).
      setFailure('We couldn’t save that just now. You can add it later from Account.');
    } finally {
      setSaving(false);
    }
  }, [firstName]);

  const skip = useCallback(() => {
    // Dismissed first, written after. See the header.
    setAsk(false);
    void api.skipNamePrompt().catch(() => {});
  }, []);

  if (!ask) return null;

  return (
    <View style={styles.block} testID={testID}>
      <Text style={styles.heading} accessibilityRole="header">
        What should we call you?
      </Text>
      <Text style={styles.body}>
        Optional. It goes on your receipts, and it is what we use if we need to contact you
        about an order.
      </Text>

      <TextField
        label="Your name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="Priya"
        autoCapitalize="words"
        testID={`${testID}-first-name`}
      />

      {failure === null ? null : (
        <Text style={styles.failure} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {failure}
        </Text>
      )}

      <View style={styles.actions}>
        <Button label="Save" onPress={save} loading={saving} testID={`${testID}-save`} />
        {/*
          A real button with a real word, not a cross in a corner. `P18` says "a clear skip",
          and the commonest way an optional field stops being optional is that declining it is
          harder to find than answering it.
        */}
        <Button
          label="Not now"
          variant="secondary"
          onPress={skip}
          disabled={saving}
          testID={`${testID}-skip`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A card, because on the confirmation screen this sits on the brand green: `bg.surface`
  // keeps the field and its label at the contrast they were designed against, and a text input
  // drawn on the brand fill is the one control on that screen somebody reads while typing.
  block: {
    width: '100%',
    gap: space[3],
    padding: layout.gutter,
    borderRadius: radius.lg,
    backgroundColor: bg.surface,
  },
  heading: {
    color: text.primary,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
  },
  body: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  failure: {
    color: text.danger,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  actions: { gap: space[2] },
});
